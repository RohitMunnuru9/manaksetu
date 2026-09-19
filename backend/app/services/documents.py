"""Reading tender documents, whatever shape they arrive in.

Three kinds of PDF turn up in procurement, and they need different handling:

* born-digital, with a real text layer -- read directly, instantly;
* scanned, an image of a printed page -- needs OCR;
* handwritten, or a scan of a photocopy of a fax -- OCR will produce
  *something*, and that something may be nonsense.

The third case is the dangerous one. Optical recognition does not fail loudly:
it returns confident-looking text like "12762 = mae ut", which then drives
retrieval and produces standard recommendations built on noise. So every
OCR pass here is scored, and the score travels with the text. When it is poor
the interface says so, rather than letting an officer assume the system read
their document properly.

Handwriting specifically: Tesseract is trained on printed type. Neat block
capitals often survive; cursive generally does not. We try, we measure, and we
report honestly -- we do not pretend.
"""

import logging
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from shutil import which
from time import monotonic

import fitz
import pdfplumber
import pytesseract
from docx import Document
from openpyxl import load_workbook
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Table extraction is the expensive part of reading a PDF. On a real 233-page
# tender, pdfplumber took 47 seconds while PyMuPDF read every page of text in
# under one -- long enough that the browser gave up and the upload appeared to
# fail. Specifications put their tables near the front, so scanning the opening
# pages captures them at a fraction of the cost. Text from every page is still
# read in full.
MAX_TABLE_PAGES = 25

# Real tenders are long. The civil specification used to develop this runs to
# 467,000 characters, and a 120,000 ceiling kept only its opening quarter --
# the site investigation -- while every mention of the concrete it was actually
# specifying fell outside. Term counting reads the whole of what is kept, so
# the ceiling decides what the system is able to notice at all.
MAX_TEXT_CHARS = 600_000

# Where even that is exceeded, the document is sampled rather than cut off, so
# its later sections are represented. Chunks are taken at even intervals and
# joined; the marker makes the gap visible to anyone reading the stored text.
SAMPLE_CHUNKS = 24
SAMPLE_MARKER = "\n\n[… a section of this document was not included …]\n\n"

# Tesseract wants roughly 300 DPI. A PDF page is 72 DPI by default, so the
# page is rendered at a little over four times scale before recognition.
OCR_SCALE = 300 / 72

# OCR costs one to three seconds a page. A 233-page scan would therefore take
# longer than any browser will wait, so the work is bounded and what was left
# out is reported rather than silently dropped.
OCR_PAGE_LIMIT = 40
OCR_TIME_BUDGET_SECONDS = 90.0

# Mean per-word confidence, as Tesseract reports it (0-100). The bands are set
# from measurement, not taste. A clean scan of printed type comes back above
# 90. A page of handwriting in this project's own test came back at 75 while
# mangling "Requisition" into "Requisitiow", turning 500 into SOO, and dropping
# two lines entirely -- so 75 cannot mean "reliable". The bar for trusting OCR
# output is therefore set well above where handwriting lands.
#   >= 88  consistent with a clean scan of printed text
#   62-88  legible but with real errors; the officer must read it
#   <  62  not usable as evidence
OCR_CONFIDENT = 88.0
OCR_USABLE = 62.0

# Tesseract's default page segmentation assumes a printed layout with columns.
# Handwriting and photographed notes do better read as a single uniform block,
# so a low-scoring page is tried again that way and the better result kept.
OCR_RETRY_CONFIG = "--psm 6"

# A page with less text than this is treated as an image of a page rather than
# a page of text, and is sent to OCR on its own.
PAGE_TEXT_FLOOR = 25

# Windows installers add Tesseract to the system PATH, but a process started
# before the install keeps a stale copy of it. Checking the usual install
# locations as well means OCR works without anyone restarting their shell.
FALLBACK_TESSERACT_PATHS = (
    "C:/Program Files/Tesseract-OCR/tesseract.exe",
    "C:/Program Files (x86)/Tesseract-OCR/tesseract.exe",
    "/usr/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/opt/homebrew/bin/tesseract",
)


class DocumentUnreadable(Exception):
    """Raised when a file cannot be opened at all. Carries a sentence meant to
    be shown to the officer, not a stack trace."""


@lru_cache(maxsize=1)
def tesseract_path() -> str | None:
    """Absolute path to the Tesseract binary, or None when it is unavailable."""
    configured = os.environ.get("TESSERACT_CMD")
    if configured and Path(configured).exists():
        return configured
    found = which("tesseract")
    if found:
        return found
    for candidate in FALLBACK_TESSERACT_PATHS:
        if Path(candidate).exists():
            return candidate
    return None


def ocr_available() -> bool:
    path = tesseract_path()
    if path is None:
        return False
    # pytesseract shells out to this path, so point it at what we resolved.
    pytesseract.pytesseract.tesseract_cmd = path
    return True


@dataclass
class ExtractionResult:
    text: str
    page_count: int
    method: str
    requires_ocr: bool = False
    tables_found: int = 0
    # Mean per-word Tesseract confidence over the pages that were recognised.
    ocr_confidence: float | None = None
    ocr_pages: int = 0
    # "digital" | "good" | "low" | "unreadable"
    quality: str = "digital"
    # Plain sentences for the officer about how this document was read.
    notes: list[str] = field(default_factory=list)


def _fit(text: str) -> tuple[str, bool]:
    """Bring `text` within the ceiling. Returns the text and whether sampling
    was needed.

    Taking the first N characters answers "what does this document open with",
    which for a tender is its title page and its conditions of contract. Taking
    slices from end to end answers "what is this document about", which is the
    question being asked.
    """
    if len(text) <= MAX_TEXT_CHARS:
        return text, False

    span = MAX_TEXT_CHARS // SAMPLE_CHUNKS
    step = len(text) // SAMPLE_CHUNKS
    pieces = [text[start : start + span] for start in range(0, len(text), step)][:SAMPLE_CHUNKS]
    return SAMPLE_MARKER.join(pieces), True


def extract_document(path: Path, content_type: str) -> ExtractionResult:
    if content_type == "application/pdf":
        return _extract_pdf(path)
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_docx(path)
    if content_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return _extract_xlsx(path)
    if content_type == "text/plain":
        return ExtractionResult(path.read_text(encoding="utf-8", errors="replace"), 1, "plain_text")
    if content_type.startswith("image/"):
        return _extract_image(path)
    raise DocumentUnreadable("That file type cannot be read. Upload a PDF, Word, Excel, text file or a photo of the pages.")


def _open_pdf(path: Path) -> fitz.Document:
    """Open a PDF, or explain in one sentence why it cannot be opened."""
    try:
        document = fitz.open(path)
    except Exception as exc:  # noqa: BLE001 - any malformed file lands here
        logger.info("Could not open %s: %s", path.name, exc)
        raise DocumentUnreadable(
            "This PDF could not be opened. It may be damaged or incomplete — try re-saving or re-downloading it."
        ) from exc

    if document.needs_pass:
        # Many bank and government PDFs are encrypted with an empty owner
        # password, which opens without anyone typing anything.
        if not document.authenticate(""):
            document.close()
            raise DocumentUnreadable(
                "This PDF is password protected, so its text cannot be read. "
                "Open it, save an unprotected copy, and upload that."
            )
    return document


def _recognise(image: Image.Image, config: str = "") -> tuple[str, float | None]:
    """One recognition pass. Returns its words joined, and mean confidence."""
    try:
        data = pytesseract.image_to_data(image, config=config, output_type=pytesseract.Output.DICT)
    except Exception as exc:  # noqa: BLE001 - a page failing must not end the run
        logger.info("OCR pass failed: %s", exc)
        return "", None

    words: list[str] = []
    confidences: list[float] = []
    for word, confidence in zip(data.get("text", []), data.get("conf", [])):
        word = (word or "").strip()
        try:
            confidence = float(confidence)
        except (TypeError, ValueError):
            continue
        # Tesseract reports -1 for layout boxes that hold no word.
        if word and confidence >= 0:
            words.append(word)
            confidences.append(confidence)

    text = " ".join(words)
    mean = sum(confidences) / len(confidences) if confidences else None
    return text, mean


def _best_of(image: Image.Image) -> tuple[str, float | None]:
    """Read a page, and read it again a different way if the first was poor.

    Keeping the better of two passes is worth the extra second on the pages
    that need it -- and a page that scores badly under both is exactly the page
    an officer needs warning about.
    """
    text, confidence = _recognise(image)
    if confidence is not None and confidence >= OCR_CONFIDENT:
        return text, confidence

    alt_text, alt_confidence = _recognise(image, OCR_RETRY_CONFIG)
    if alt_confidence is not None and (confidence is None or alt_confidence > confidence):
        return alt_text, alt_confidence
    return text, confidence


def _prepare(image: Image.Image) -> Image.Image:
    """Greyscale and autocontrast: scans of photocopies and phone photographs
    carry a colour cast and weak contrast that cost real accuracy, and both are
    cheap to correct."""
    return ImageOps.autocontrast(ImageOps.grayscale(image))


def _ocr_page(page: fitz.Page) -> tuple[str, float | None]:
    """Recognise one rendered PDF page."""
    pixmap = page.get_pixmap(matrix=fitz.Matrix(OCR_SCALE, OCR_SCALE), alpha=False)
    image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
    return _best_of(_prepare(image))


def _quality_of(confidence: float | None) -> str:
    if confidence is None:
        return "unreadable"
    if confidence >= OCR_CONFIDENT:
        return "good"
    if confidence >= OCR_USABLE:
        return "low"
    return "unreadable"


def _extract_pdf(path: Path) -> ExtractionResult:
    document = _open_pdf(path)
    page_texts = [page.get_text("text").strip() for page in document]
    notes: list[str] = []

    # Which pages carry no text layer? A tender is often part digital and part
    # scanned -- a signed annexure photographed and appended, say -- and
    # deciding per page means the scanned part is not lost because the rest of
    # the document happened to be long enough to look fine in total.
    image_pages = [index for index, text in enumerate(page_texts) if len(text) < PAGE_TEXT_FLOOR]

    tables: list[str] = []
    try:
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages[:MAX_TABLE_PAGES]:
                for table in page.extract_tables():
                    for row in table:
                        values = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
                        if values:
                            tables.append(" | ".join(values))
    except Exception as exc:  # noqa: BLE001 - tables are a bonus, never the point
        logger.info("Table extraction skipped for %s: %s", path.name, exc)

    confidences: list[float] = []
    recognised = 0
    if image_pages and ocr_available():
        started = monotonic()
        for position, index in enumerate(image_pages):
            if position >= OCR_PAGE_LIMIT or monotonic() - started > OCR_TIME_BUDGET_SECONDS:
                remaining = len(image_pages) - position
                notes.append(
                    f"{remaining} more scanned page{'s' if remaining != 1 else ''} were not read — "
                    "the document was too long to recognise in full."
                )
                break
            text, confidence = _ocr_page(document[index])
            if text:
                page_texts[index] = text
                recognised += 1
            if confidence is not None:
                confidences.append(confidence)
    elif image_pages:
        notes.append(
            "Some pages are images and text recognition is not installed on this machine, so they were not read."
        )

    document.close()

    text = "\n\n".join(part for part in page_texts if part)
    if tables:
        text = f"{text}\n\nExtracted tables:\n" + "\n".join(tables)
    original_length = len(text)
    text, sampled = _fit(text)
    if sampled:
        logger.info("Sampled %d characters across a %d character document.", len(text), original_length)
        notes.append(
            f"This document is {original_length:,} characters long. Passages were read from "
            "across the whole of it rather than only the beginning."
        )

    confidence = sum(confidences) / len(confidences) if confidences else None
    page_count = len(page_texts)

    if recognised == 0:
        method = "pymupdf"
        quality = "digital"
    else:
        method = "tesseract" if recognised == page_count else "pymupdf+tesseract"
        quality = _quality_of(confidence)
        notes.insert(0, _ocr_note(recognised, page_count, confidence, quality))

    if not text.strip():
        quality = "unreadable"
        notes.append("No readable text could be taken from this document.")

    return ExtractionResult(
        text=text,
        page_count=page_count,
        method=method,
        requires_ocr=bool(image_pages) and recognised == 0,
        tables_found=len(tables),
        ocr_confidence=round(confidence, 1) if confidence is not None else None,
        ocr_pages=recognised,
        quality=quality,
        notes=notes,
    )


def _ocr_note(recognised: int, total: int, confidence: float | None, quality: str) -> str:
    where = "The whole document" if recognised == total else f"{recognised} of {total} pages"
    if confidence is None:
        return f"{where} had to be read by text recognition, and nothing legible came back."
    score = f"{confidence:.0f}%"
    if quality == "good":
        return f"{where} was read by text recognition, which was confident ({score}) about what it read."
    if quality == "low":
        return (
            f"{where} was read by text recognition at {score} confidence — readable, but with "
            "real mistakes. Handwriting in particular comes back with words altered or missing "
            "entirely. Read the text below and correct it before relying on these results."
        )
    return (
        f"{where} was read by text recognition, which managed only {score} confidence. "
        "The text is not reliable enough to draw conclusions from — this usually means handwriting, "
        "a photograph taken at an angle, or a very poor scan."
    )


def _extract_image(path: Path) -> ExtractionResult:
    if not ocr_available():
        return ExtractionResult(
            "", 1, "ocr_unavailable", True, quality="unreadable",
            notes=["Text recognition is not installed on this machine, so this image could not be read."],
        )
    try:
        image = Image.open(path)
        image.load()
    except Exception as exc:  # noqa: BLE001
        raise DocumentUnreadable("That image could not be opened. Try a PNG or JPEG.") from exc

    # Photographs of paper arrive in every orientation and exposure; the same
    # cheap corrections used for PDF pages apply here.
    image = _prepare(ImageOps.exif_transpose(image).convert("RGB"))
    text, confidence = _best_of(image)
    quality = _quality_of(confidence) if text else "unreadable"
    notes = [_ocr_note(1, 1, confidence, quality)] if text else ["No readable text was found in this image."]
    return ExtractionResult(
        text=text,
        page_count=1,
        method="tesseract",
        requires_ocr=not bool(text),
        ocr_confidence=round(confidence, 1) if confidence is not None else None,
        ocr_pages=1 if text else 0,
        quality=quality,
        notes=notes,
    )


def _extract_docx(path: Path) -> ExtractionResult:
    try:
        document = Document(path)
    except Exception as exc:  # noqa: BLE001
        raise DocumentUnreadable("This Word file could not be opened. It may be damaged.") from exc
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            paragraphs.append(" | ".join(cell.text.strip() for cell in row.cells))
    return ExtractionResult("\n".join(paragraphs), 1, "python_docx")


def _extract_xlsx(path: Path) -> ExtractionResult:
    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise DocumentUnreadable("This spreadsheet could not be opened. It may be damaged.") from exc
    rows: list[str] = []
    for sheet in workbook.worksheets:
        rows.append(f"Sheet: {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            values = [str(value).strip() for value in row if value is not None and str(value).strip()]
            if values:
                rows.append(" | ".join(values))
    return ExtractionResult("\n".join(rows), len(workbook.sheetnames), "openpyxl")
