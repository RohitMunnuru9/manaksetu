from datetime import date
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ProductCategory, QualityControlOrder, Standard, StandardStatus, VerificationStatus


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
    category = db.scalar(select(ProductCategory).where(ProductCategory.name == "Personal protective equipment"))
    if category is None:
        category = ProductCategory(name="Personal protective equipment", description="Curated MVP category")
        db.add(category)
        db.flush()

    if db.scalar(select(Standard.id).where(Standard.verification_status == VerificationStatus.demo).limit(1)) is None:
        for row in DEMO_STANDARDS:
            db.add(Standard(
                standard_number=None,
                official_title=row["official_title"],
                scope_summary=row["scope_summary"],
                status=StandardStatus.uncertain,
                verification_status=VerificationStatus.demo,
                category_id=category.id,
            ))

    standard = db.scalar(select(Standard).where(Standard.standard_number == "IS 2925:1984"))
    if standard is None:
        standard_source = "https://lims.bis.gov.in/home/search_is_number/?is_number__doc_no=2925"
        standard = Standard(
            standard_number="IS 2925:1984",
            official_title="Specification for industrial safety helmets (Second Revision)",
            scope_summary="Industrial safety helmets for occupational protection; official public metadata only.",
            publication_year=1984,
            revision_number="Second Revision",
            status=StandardStatus.current,
            official_source_url=standard_source,
            source_organisation="Bureau of Indian Standards",
            retrieved_date=date(2026, 9, 14),
            last_checked_date=date(2026, 9, 14),
            verification_status=VerificationStatus.verified,
            content_hash=sha256(f"IS 2925:1984|Specification for industrial safety helmets (Second Revision)|{standard_source}".encode()).hexdigest(),
            category_id=category.id,
        )
        db.add(standard)
        db.flush()

    if db.scalar(select(QualityControlOrder.id).where(QualityControlOrder.mandated_standard_id == standard.id)) is None:
        qco_source = "https://www.bis.gov.in/wp-content/uploads/2023/10/Helmet-for-Police-Force-Civil-Defence-Personal-Protection-QCO-2023.pdf"
        db.add(QualityControlOrder(
            title="Helmet for Police Force, Civil Defence and Personal Protection (Quality Control) Order, 2023 — S.O. 4649(E)",
            product_keyword="industrial safety helmet",
            mandated_standard_id=standard.id,
            enforcement_date=date(2024, 4, 24),
            official_source_url=qco_source,
            verification_status=VerificationStatus.verified,
            exemptions=["goods or articles manufactured domestically for export"],
        ))
    db.commit()
