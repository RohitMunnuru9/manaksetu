from pathlib import Path

import pytest

from app.models import Recommendation, Standard, Tender, VerificationStatus
from app.services.documents import extract_document, ocr_available


def _scanned_pdf(path: Path) -> Path:
    """A PDF containing only a rendered image, with no text layer at all."""
    import fitz
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (1240, 400), "white")
    draw = ImageDraw.Draw(image)
    for index, line in enumerate([
        "TENDER NOTICE 2026/PPE/114",
        "Purchase of 1000 industrial safety helmet units",
        "for construction workers.",
    ]):
        draw.text((40, 50 + index * 80), line, fill="black")
    png = path.with_suffix(".png")
    image.save(png)

    document = fitz.open()
    page = document.new_page(width=620, height=200)
    page.insert_image(fitz.Rect(0, 0, 620, 200), filename=str(png))
    document.save(str(path))
    document.close()
    return path


def test_scanned_pdf_has_no_text_layer_to_extract(tmp_path: Path) -> None:
    """Guards the fixture itself: if this had a text layer, the OCR test would be meaningless."""
    import fitz

    pdf = _scanned_pdf(tmp_path / "scan.pdf")
    assert fitz.open(str(pdf))[0].get_text("text").strip() == ""


@pytest.mark.skipif(not ocr_available(), reason="Tesseract is not installed on this machine")
def test_scanned_pdf_is_read_by_ocr(tmp_path: Path) -> None:
    result = extract_document(_scanned_pdf(tmp_path / "scan.pdf"), "application/pdf")
    assert result.method == "tesseract"
    assert result.requires_ocr is False
    collapsed = result.text.lower().replace(" ", "")
    assert "helmet" in collapsed and "tender" in collapsed


def test_scanned_pdf_without_ocr_hands_off_safely(tmp_path: Path, monkeypatch) -> None:
    """With no OCR engine the document is flagged, never silently returned empty."""
    monkeypatch.setattr("app.services.documents.ocr_available", lambda: False)
    result = extract_document(_scanned_pdf(tmp_path / "scan.pdf"), "application/pdf")
    assert result.requires_ocr is True
    assert result.method == "pymupdf"
from app.services.reports import build_docx, build_json, build_pdf, build_xlsx


def test_extract_plain_text(tmp_path: Path) -> None:
    source = tmp_path / "tender.txt"
    source.write_text("Purchase industrial safety helmets with impact testing.", encoding="utf-8")
    result = extract_document(source, "text/plain")
    assert "safety helmets" in result.text
    assert result.method == "plain_text"
    assert result.requires_ocr is False


def sample_report_data() -> tuple[Tender, list[Recommendation]]:
    standard = Standard(
        official_title="Demonstration protective equipment record",
        scope_summary="Demo only",
        verification_status=VerificationStatus.demo,
    )
    recommendation = Recommendation(
        tender_id=1,
        standard_id=1,
        standard=standard,
        standard_type="primary",
        reason="Matched against controlled demonstration metadata.",
        matched_requirements=["protective", "equipment"],
        confidence_score=0.62,
        human_review_required=True,
    )
    tender = Tender(reference="MS-TEST-001", title="Test procurement", source_text="protective equipment")
    return tender, [recommendation]


def test_all_report_formats_are_generated() -> None:
    tender, recommendations = sample_report_data()
    json_report = build_json(tender, recommendations)
    pdf_report = build_pdf(tender, recommendations)
    docx_report = build_docx(tender, recommendations)
    xlsx_report = build_xlsx(tender, recommendations)
    assert b'"MS-TEST-001"' in json_report
    assert pdf_report.startswith(b"%PDF")
    assert docx_report.startswith(b"PK")
    assert xlsx_report.startswith(b"PK")


# --- Reading documents that are not clean digital PDFs -----------------------

import fitz
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.services.documents import (
    DocumentUnreadable,
    extract_document,
    ocr_available,
    _quality_of,
    OCR_CONFIDENT,
    OCR_USABLE,
)


def _page_image(lines: list[str], font_path: str | None = None) -> Image.Image:
    image = Image.new("RGB", (1240, 700), "white")
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype(font_path or "arial.ttf", 34)
    except OSError:
        font = ImageFont.load_default()
    y = 70
    for line in lines:
        draw.text((90, y), line, font=font, fill=(20, 20, 20))
        y += 85
    return image


def _image_pdf(tmp_path, lines: list[str], name: str = "scan.pdf"):
    """A PDF with no text layer at all -- only a picture of a page."""
    png = tmp_path / f"{name}.png"
    _page_image(lines).save(png)
    path = tmp_path / name
    document = fitz.open()
    page = document.new_page(width=842, height=595)
    page.insert_image(fitz.Rect(0, 0, 842, 595), filename=str(png))
    document.save(path)
    document.close()
    return path


def test_quality_bands_are_ordered():
    """The bands must not overlap, and handwriting-range scores must not be
    reported as reliable -- a 75% page was measured mangling words outright."""
    assert OCR_USABLE < OCR_CONFIDENT
    assert _quality_of(OCR_CONFIDENT) == "good"
    assert _quality_of(OCR_USABLE) == "low"
    assert _quality_of(OCR_USABLE - 1) == "unreadable"
    assert _quality_of(None) == "unreadable"
    # The specific regression: 75% must never be called reliable.
    assert _quality_of(75.0) != "good"


def test_encrypted_pdf_is_refused_with_an_explanation(tmp_path):
    """A password-protected file must produce a sentence an officer can act
    on, not an unhandled error."""
    path = tmp_path / "locked.pdf"
    document = fitz.open()
    document.new_page()
    document.save(path, encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    document.close()

    with pytest.raises(DocumentUnreadable) as caught:
        extract_document(path, "application/pdf")
    assert "password protected" in str(caught.value).lower()


def test_damaged_pdf_is_refused_with_an_explanation(tmp_path):
    path = tmp_path / "broken.pdf"
    path.write_bytes(b"%PDF-1.4 this is not really a pdf")
    with pytest.raises(DocumentUnreadable):
        extract_document(path, "application/pdf")


def test_unsupported_type_is_refused_politely(tmp_path):
    path = tmp_path / "thing.bin"
    path.write_bytes(b"\x00\x01\x02")
    with pytest.raises(DocumentUnreadable):
        extract_document(path, "application/octet-stream")


@pytest.mark.skipif(not ocr_available(), reason="Tesseract is not installed here")
def test_scanned_pdf_is_read_and_scored(tmp_path):
    """A PDF with no text layer must still be read, and must carry a score and
    a note saying recognition was used."""
    path = _image_pdf(tmp_path, [
        "Supply of 500 industrial safety helmets",
        "for construction workers at the site.",
        "Impact testing certificate required.",
    ])
    result = extract_document(path, "application/pdf")

    assert "helmet" in result.text.lower()
    assert result.ocr_pages == 1
    assert result.ocr_confidence is not None
    assert result.quality in {"good", "low", "unreadable"}
    assert result.notes and "recognition" in result.notes[0]


@pytest.mark.skipif(not ocr_available(), reason="Tesseract is not installed here")
def test_mixed_pdf_reads_its_scanned_page_too(tmp_path):
    """One digital page and one scanned page. The scanned one must not be
    skipped merely because the document as a whole already had enough text --
    that was the original bug: a whole annexure silently ignored."""
    png = tmp_path / "page.png"
    _page_image(["Annexure: safety helmets required"]).save(png)

    path = tmp_path / "mixed.pdf"
    document = fitz.open()
    digital = document.new_page(width=842, height=595)
    digital.insert_text((72, 96), "Tender for procurement of cement " * 30, fontsize=11)
    scanned = document.new_page(width=842, height=595)
    scanned.insert_image(fitz.Rect(0, 0, 842, 595), filename=str(png))
    document.save(path)
    document.close()

    result = extract_document(path, "application/pdf")
    assert "cement" in result.text.lower()          # the digital page
    assert "helmet" in result.text.lower()          # the scanned one
    assert result.ocr_pages == 1
    assert result.method == "pymupdf+tesseract"
