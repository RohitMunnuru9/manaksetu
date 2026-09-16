import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from shutil import which

import fitz
import pdfplumber
import pytesseract
from docx import Document
from openpyxl import load_workbook
from PIL import Image

logger = logging.getLogger(__name__)

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


def extract_document(path: Path, content_type: str) -> ExtractionResult:
    if content_type == "application/pdf":
        return _extract_pdf(path)
    if content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_docx(path)
    if content_type == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        return _extract_xlsx(path)
    if content_type == "text/plain":
        return ExtractionResult(path.read_text(encoding="utf-8", errors="replace"), 1, "plain_text")
    if content_type in {"image/png", "image/jpeg"}:
        return _extract_image(path)
    raise ValueError("Unsupported document type")


def _extract_pdf(path: Path) -> ExtractionResult:
    document = fitz.open(path)
    pages = [page.get_text("text") for page in document]
    text = "\n\n".join(page.strip() for page in pages if page.strip())
    tables: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for row in table:
                    values = [str(cell).strip() for cell in row if cell is not None and str(cell).strip()]
                    if values:
                        tables.append(" | ".join(values))
    if tables:
        text = f"{text}\n\nExtracted tables:\n" + "\n".join(tables)
    requires_ocr = len(text.strip()) < max(40, len(document) * 15)
    if requires_ocr and ocr_available():
        ocr_pages = []
        for page in document:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
            ocr_pages.append(pytesseract.image_to_string(image))
        ocr_text = "\n\n".join(ocr_pages).strip()
        if ocr_text:
            return ExtractionResult(ocr_text, len(document), "tesseract", False, len(tables))
    return ExtractionResult(text, len(document), "pymupdf", requires_ocr, len(tables))


def _extract_image(path: Path) -> ExtractionResult:
    if not ocr_available():
        return ExtractionResult("", 1, "ocr_unavailable", True)
    text = pytesseract.image_to_string(Image.open(path)).strip()
    return ExtractionResult(text, 1, "tesseract", not bool(text))


def _extract_docx(path: Path) -> ExtractionResult:
    document = Document(path)
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            paragraphs.append(" | ".join(cell.text.strip() for cell in row.cells))
    return ExtractionResult("\n".join(paragraphs), 1, "python_docx")


def _extract_xlsx(path: Path) -> ExtractionResult:
    workbook = load_workbook(path, read_only=True, data_only=True)
    rows: list[str] = []
    for sheet in workbook.worksheets:
        rows.append(f"Sheet: {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            values = [str(value).strip() for value in row if value is not None and str(value).strip()]
            if values:
                rows.append(" | ".join(values))
    return ExtractionResult("\n".join(rows), len(workbook.sheetnames), "openpyxl")
