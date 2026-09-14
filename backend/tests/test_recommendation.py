from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import QualityControlOrder, Standard, VerificationStatus
from app.services.recommendation import confidence_level, evaluate_qco, extract_terms, find_candidates, missing_requirements


def make_db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_keyword_candidate_ranking() -> None:
    db = make_db()
    db.add(Standard(official_title="Industrial safety helmet", scope_summary="construction worker head protection", verification_status=VerificationStatus.demo))
    db.commit()
    results = find_candidates(db, "Purchase construction safety helmets for workers")
    assert results
    assert "construction" in results[0].matched_terms


def test_unverified_qco_never_creates_mandatory_claim() -> None:
    db = make_db()
    standard = Standard(official_title="Demo helmet standard", verification_status=VerificationStatus.demo)
    db.add(standard)
    db.flush()
    db.add(QualityControlOrder(
        title="Unverified demo order",
        product_keyword="helmet",
        mandated_standard_id=standard.id,
        enforcement_date=date.today() - timedelta(days=1),
        official_source_url="https://example.invalid/demo",
        verification_status=VerificationStatus.demo,
    ))
    db.commit()
    result = evaluate_qco(db, "helmet procurement", standard)
    assert result["certification_required"] is False
    assert result["qco_applicable"] is False


def test_verified_qco_honours_export_exemption() -> None:
    db = make_db()
    standard = Standard(official_title="Verified helmet standard", standard_number="IS TEST:2026", official_source_url="https://example.gov.in/standard", verification_status=VerificationStatus.verified)
    db.add(standard)
    db.flush()
    db.add(QualityControlOrder(
        title="Verified test order",
        product_keyword="industrial safety helmet",
        mandated_standard_id=standard.id,
        enforcement_date=date.today() - timedelta(days=1),
        official_source_url="https://example.gov.in/qco",
        verification_status=VerificationStatus.verified,
        exemptions=["goods manufactured for export"],
    ))
    db.commit()
    domestic = evaluate_qco(db, "industrial safety helmet for construction", standard)
    exported = evaluate_qco(db, "industrial safety helmet manufactured for export", standard)
    assert domestic["certification_required"] is True
    assert exported["certification_required"] is False


def test_requirement_gap_detection() -> None:
    gaps = missing_requirements("Purchase helmets for workers")
    assert "Measurable acceptance or test criteria" in gaps
    assert "Warranty or service requirement" in gaps


def test_helpers() -> None:
    assert "helmet" in extract_terms("Purchase the helmet with straps")
    assert confidence_level(0.81) == "high"
    assert confidence_level(0.7) == "medium"
    assert confidence_level(0.4) == "low"
