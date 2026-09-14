from pathlib import Path

from app.models import Recommendation, Standard, Tender, VerificationStatus
from app.services.documents import extract_document
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
