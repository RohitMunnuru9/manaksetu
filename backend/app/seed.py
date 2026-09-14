from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ProductCategory, Standard, StandardStatus, VerificationStatus


DEMO_STANDARDS = [
    {
        "official_title": "Industrial safety helmets — demonstration specification",
        "scope_summary": "Demonstration record for helmets used by construction and industrial workers.",
    },
    {
        "official_title": "Protective equipment impact testing — demonstration method",
        "scope_summary": "Demonstration record for impact and penetration test requirements for protective equipment.",
    },
    {
        "official_title": "Safety marking and user information — demonstration guidance",
        "scope_summary": "Demonstration record for permanent marking, instructions, and traceability.",
    },
]


def seed_demo_data(db: Session) -> None:
    if db.scalar(select(Standard.id).limit(1)) is not None:
        return
    category = ProductCategory(name="Personal protective equipment", description="Curated MVP category")
    db.add(category)
    db.flush()
    for row in DEMO_STANDARDS:
        db.add(Standard(
            standard_number=None,
            official_title=row["official_title"],
            scope_summary=row["scope_summary"],
            status=StandardStatus.uncertain,
            verification_status=VerificationStatus.demo,
            category_id=category.id,
        ))
    db.commit()
