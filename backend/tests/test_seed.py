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
