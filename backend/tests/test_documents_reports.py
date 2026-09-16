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
