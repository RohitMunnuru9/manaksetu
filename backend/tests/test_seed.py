from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import QualityControlOrder, Standard, VerificationStatus
from app.seed import seed_demo_data


def test_verified_helmet_record_has_official_evidence() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed_demo_data(db)
        standard = db.scalar(select(Standard).where(Standard.standard_number == "IS 2925:1984"))
        assert standard is not None
        assert standard.verification_status == VerificationStatus.verified
        assert standard.official_source_url.startswith("https://lims.bis.gov.in/")
        assert len(standard.content_hash or "") == 64
        qco = db.scalar(select(QualityControlOrder).where(QualityControlOrder.mandated_standard_id == standard.id))
        assert qco is not None
        assert qco.verification_status == VerificationStatus.verified
        assert qco.official_source_url.startswith("https://www.bis.gov.in/")


def test_restart_does_not_undo_a_persons_verification() -> None:
    """Re-seeding must never overwrite a decision made through the workflow.

    Every server start re-applied catalogue.json to the curated records, so an
    expert's verification of IS 269 was silently reset to pending the next time
    the API restarted -- no audit entry, no warning. It ran the other way too:
    a record the file marks verified came back verified after being revoked.
    """
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed_demo_data(db)

        cement = db.scalar(select(Standard).where(Standard.standard_number == "IS 269"))
        helmet = db.scalar(select(Standard).where(Standard.standard_number == "IS 2925:1984"))
        assert cement.verification_status == VerificationStatus.pending
        assert helmet.verification_status == VerificationStatus.verified

        # An expert verifies one and revokes the other.
        cement.verification_status = VerificationStatus.verified
        cement.verification_note = "Checked against the official BIS page."
        helmet.verification_status = VerificationStatus.pending
        db.commit()

        # The server restarts.
        seed_demo_data(db)
        db.refresh(cement)
        db.refresh(helmet)

        assert cement.verification_status == VerificationStatus.verified
        assert cement.verification_note == "Checked against the official BIS page."
        assert helmet.verification_status == VerificationStatus.pending


def test_demonstration_records_never_gain_a_number_on_reseed() -> None:
    """Preserving workflow state must not let a demo record keep an identifier."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        seed_demo_data(db)
        seed_demo_data(db)
        demos = db.scalars(select(Standard).where(Standard.verification_status == VerificationStatus.demo)).all()
        assert demos
        assert all(record.standard_number is None for record in demos)
