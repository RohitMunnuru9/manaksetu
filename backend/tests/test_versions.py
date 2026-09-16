"""Tests for version, amendment and supersession checking."""

from datetime import date

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Standard, StandardAmendment, StandardStatus, VerificationStatus
from app.seed import seed_demo_data
from app.services.versions import describe_currency, outdated_citations


@pytest.fixture(scope="module")
def seeded_db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = Session(engine)
    seed_demo_data(db)
    return db


def test_catalogue_seeds_a_superseded_record(seeded_db: Session) -> None:
    withdrawn = seeded_db.scalar(select(Standard).where(Standard.status == StandardStatus.withdrawn))
    assert withdrawn is not None, "catalogue should contain a superseded record"
    assert withdrawn.superseded_by_id is not None
    assert withdrawn.superseded_by.standard_number == "IS 2925:1984"


def test_superseded_record_reports_its_replacement(seeded_db: Session) -> None:
    withdrawn = seeded_db.scalar(select(Standard).where(Standard.status == StandardStatus.withdrawn))
    currency = describe_currency(withdrawn)
    assert currency["is_outdated"] is True
    assert currency["superseded_by"] == "IS 2925:1984"
    assert "superseded by IS 2925:1984" in currency["currency_warning"]


def test_current_record_without_amendments_raises_no_warning(seeded_db: Session) -> None:
    current = seeded_db.scalar(select(Standard).where(Standard.standard_number == "IS 2925:1984"))
    currency = describe_currency(current)
    assert currency["is_outdated"] is False
    assert currency["currency_warning"] is None


def test_amendments_are_reported_against_the_base_record(seeded_db: Session) -> None:
    amended = seeded_db.scalar(
        select(Standard).where(Standard.catalogue_ref == "MS-PPE-HELMET-TEST")
    )
    currency = describe_currency(amended)
    assert len(currency["amendments"]) == 2
    assert currency["is_outdated"] is False
    assert "2 amendments issued" in currency["currency_warning"]


def test_no_amendment_is_claimed_against_the_verified_standard(seeded_db: Session) -> None:
    """None has been checked against an official source, so none may be asserted."""
    verified = seeded_db.scalar(select(Standard).where(Standard.standard_number == "IS 2925:1984"))
    assert verified.amendments == []


def test_amendment_claiming_verification_without_a_source_is_downgraded() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        standard = Standard(official_title="Probe record")
        db.add(standard)
        db.flush()
        db.add(StandardAmendment(
            standard_id=standard.id,
            amendment_number="Amendment 1",
            issued_date=date(2020, 1, 1),
            official_source_url=None,
            verification_status=VerificationStatus.pending,
        ))
        db.commit()
        stored = db.scalar(select(StandardAmendment))
        assert stored.verification_status != VerificationStatus.verified


# --- citations inside the tender itself ---------------------------------

def test_tender_citing_a_current_standard_raises_nothing(seeded_db: Session) -> None:
    assert outdated_citations(seeded_db, "Helmets shall conform to IS 2925:1984.") == []


def test_tender_citing_an_unknown_number_raises_nothing(seeded_db: Session) -> None:
    """The catalogue cannot speak to a standard it does not hold."""
    assert outdated_citations(seeded_db, "Helmets shall conform to IS 9999:2001.") == []


def test_unverified_records_are_never_matched_against_a_citation(seeded_db: Session) -> None:
    """Unverified records have no number, so no tender can be citing one."""
    findings = outdated_citations(seeded_db, "Refer to MS-PPE-HELMET-SUPERSEDED for headgear.")
    assert findings == []


def test_citation_matching_tolerates_a_missing_year(seeded_db: Session) -> None:
    """An officer writing 'IS 2925' should still reach the 'IS 2925:1984' record."""
    verified = seeded_db.scalar(select(Standard).where(Standard.standard_number == "IS 2925:1984"))
    verified.status = StandardStatus.revised
    seeded_db.flush()
    try:
        findings = outdated_citations(seeded_db, "Helmets shall conform to IS 2925.")
        assert len(findings) == 1
        assert findings[0]["cited_standard"] == "IS 2925:1984"
        assert findings[0]["status"] == "revised"
    finally:
        verified.status = StandardStatus.current
        seeded_db.flush()
