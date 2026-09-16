"""Load the controlled standards catalogue into the database.

The catalogue lives in ``app/data/catalogue.json`` so that standards data is
editable by the team without touching code. Seeding is idempotent and enforces
the verification rule in code, not merely by convention: a record claiming
``verified`` status without complete official evidence is downgraded to
``pending`` and logged, so a data-entry mistake can never promote an unverified
identifier into something the interface presents as fact.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from hashlib import sha256
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import (
    ProductCategory,
    QualityControlOrder,
    Standard,
    StandardAmendment,
    StandardRelationship,
    StandardStatus,
    User,
    VerificationStatus,
)
from .security import hash_password
from .services.embeddings import semantic_index, standard_document

logger = logging.getLogger(__name__)

CATALOGUE_PATH = Path(__file__).resolve().parent / "data" / "catalogue.json"

# A record may only be presented as verified when every one of these is present.
REQUIRED_FOR_VERIFIED = ("standard_number", "official_title", "official_source_url", "source_organisation", "last_checked_date")


def _parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _content_hash(row: dict) -> str | None:
    """Hash the official evidence so a later source change is detectable."""
    if row.get("verification_status") != "verified":
        return None
    basis = f"{row['standard_number']}|{row['official_title']}|{row['official_source_url']}"
    return sha256(basis.encode()).hexdigest()


def _effective_verification(row: dict) -> VerificationStatus:
    """Three tiers, and a record can only ever be demoted here, never promoted.

    verified  a human has checked the record against the official BIS entry
    pending   imported from an official BIS source, identifier shown, unconfirmed
    demo      illustrative only, carries no identifier at all
    """
    claimed = row.get("verification_status", "demo")
    if claimed != "verified":
        return VerificationStatus(claimed)
    missing = [field for field in REQUIRED_FOR_VERIFIED if not row.get(field)]
    if missing:
        logger.warning(
            "Record %r claims verified status but is missing %s; downgrading to pending.",
            row.get("key"), ", ".join(missing),
        )
        return VerificationStatus.pending
    return VerificationStatus.verified


def _seed_demo_users(db: Session, settings) -> None:
    """Seed local demonstration accounts.

    A second, deliberately restricted supplier account exists so role-based
    access control can be demonstrated rather than merely asserted: signing in
    as the supplier shows review, export and audit refused by the API.
    """
    accounts = [
        (settings.demo_user_email, settings.demo_user_password, "Ananya Rao", "procurement_officer"),
        ("supplier@example.in", settings.demo_user_password, "Vikram Shetty", "supplier"),
    ]
    for email, password, full_name, role in accounts:
        if db.scalar(select(User.id).where(User.email == email.lower()).limit(1)) is None:
            db.add(User(
                email=email.lower(),
                full_name=full_name,
                role=role,
                password_hash=hash_password(password),
            ))


def load_catalogue() -> dict:
    with CATALOGUE_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def seed_demo_data(db: Session) -> None:
    settings = get_settings()
    if settings.seed_demo_users:
        _seed_demo_users(db, settings)

    catalogue = load_catalogue()

    categories: dict[str, ProductCategory] = {}
    for row in catalogue["categories"]:
        existing = db.scalar(select(ProductCategory).where(ProductCategory.name == row["name"]))
        if existing is None:
            existing = ProductCategory(name=row["name"], description=row.get("description", ""))
            db.add(existing)
            db.flush()
        categories[row["name"]] = existing

    by_key: dict[str, Standard] = {}
    for row in catalogue["standards"]:
        verification = _effective_verification(row)
        # Only a demonstration record is stripped of its number. An imported
        # record keeps the number it was imported with and is shown as pending,
        # because hiding a real identifier would be as misleading as inventing
        # one -- the officer needs to see it and know it is unconfirmed.
        number = None if verification == VerificationStatus.demo else row.get("standard_number")
        existing = db.scalar(select(Standard).where(Standard.official_title == row["official_title"]))
        if existing is None:
            existing = Standard(official_title=row["official_title"])
            db.add(existing)
        existing.standard_number = number
        existing.catalogue_ref = f"MS-{row['key'].upper()}"
        existing.scope_summary = row.get("scope_summary", "")
        existing.publication_year = row.get("publication_year")
        existing.revision_number = row.get("revision_number")
        existing.status = StandardStatus(row.get("status", "uncertain"))
        existing.official_source_url = row.get("official_source_url")
        existing.source_organisation = row.get("source_organisation")
        existing.retrieved_date = _parse_date(row.get("retrieved_date"))
        existing.last_checked_date = _parse_date(row.get("last_checked_date"))
        existing.verification_status = verification
        existing.content_hash = _content_hash(row)
        existing.category_id = categories[row["category"]].id
        db.flush()
        by_key[row["key"]] = existing

    _seed_embeddings(db, by_key.values())
    _seed_supersession(db, catalogue, by_key)
    _seed_amendments(db, catalogue, by_key)
    _seed_relationships(db, catalogue, by_key)
    _seed_qcos(db, catalogue, by_key)
    db.commit()


def _seed_embeddings(db: Session, standards) -> None:
    """Embed any record that has no vector yet. Silently skipped when the model is unavailable."""
    pending = [item for item in standards if not item.embedding]
    if not pending or not semantic_index.available:
        return
    documents = [standard_document(item.official_title, item.scope_summary) for item in pending]
    vectors = semantic_index.embed(documents)
    if vectors is None:
        logger.warning("Embedding model unavailable; catalogue seeded without vectors (lexical search only).")
        return
    for standard, vector in zip(pending, vectors):
        standard.embedding = vector
    db.flush()
    logger.info("Embedded %d catalogue records.", len(pending))


def _seed_supersession(db: Session, catalogue: dict, by_key: dict[str, Standard]) -> None:
    """Link each superseded record to its replacement."""
    for row in catalogue["standards"]:
        successor_key = row.get("superseded_by")
        if not successor_key:
            continue
        successor = by_key.get(successor_key)
        if successor is None:
            logger.warning("Record %r is superseded by unknown key %r", row["key"], successor_key)
            continue
        record = by_key[row["key"]]
        if record.id == successor.id:
            logger.warning("Record %r cannot supersede itself; ignoring.", row["key"])
            continue
        record.superseded_by_id = successor.id
    db.flush()


def _seed_amendments(db: Session, catalogue: dict, by_key: dict[str, Standard]) -> None:
    for row in catalogue["standards"]:
        standard = by_key[row["key"]]
        for entry in row.get("amendments", []):
            exists = db.scalar(
                select(StandardAmendment.id).where(
                    StandardAmendment.standard_id == standard.id,
                    StandardAmendment.amendment_number == entry["amendment_number"],
                ).limit(1)
            )
            if exists is not None:
                continue
            # An amendment is only verified when it carries its own source.
            claimed = entry.get("verification_status", "demo")
            status = VerificationStatus(claimed)
            if status == VerificationStatus.verified and not entry.get("official_source_url"):
                logger.warning(
                    "Amendment %r of %r claims verified status without a source; downgrading.",
                    entry["amendment_number"], row["key"],
                )
                status = VerificationStatus.pending
            db.add(StandardAmendment(
                standard_id=standard.id,
                amendment_number=entry["amendment_number"],
                issued_date=_parse_date(entry.get("issued_date")),
                summary=entry.get("summary", ""),
                official_source_url=entry.get("official_source_url"),
                verification_status=status,
            ))
    db.flush()


def _seed_relationships(db: Session, catalogue: dict, by_key: dict[str, Standard]) -> None:
    for row in catalogue["standards"]:
        source = by_key[row["key"]]
        for edge in row.get("relationships", []):
            target = by_key.get(edge["target"])
            if target is None:
                logger.warning("Relationship from %r points at unknown key %r", row["key"], edge["target"])
                continue
            exists = db.scalar(
                select(StandardRelationship.id).where(
                    StandardRelationship.source_id == source.id,
                    StandardRelationship.target_id == target.id,
                    StandardRelationship.relationship_type == edge["type"],
                ).limit(1)
            )
            if exists is None:
                db.add(StandardRelationship(source_id=source.id, target_id=target.id, relationship_type=edge["type"]))
    db.flush()


def _seed_qcos(db: Session, catalogue: dict, by_key: dict[str, Standard]) -> None:
    for row in catalogue.get("quality_control_orders", []):
        standard = by_key.get(row["mandated_standard"])
        if standard is None:
            logger.warning("QCO %r references unknown standard key %r", row["title"], row["mandated_standard"])
            continue
        # A QCO may only be enforced against a verified standard; otherwise the
        # rule engine would be asserting a legal obligation about a demo record.
        if standard.verification_status != VerificationStatus.verified:
            logger.warning("QCO %r targets an unverified standard; skipping.", row["title"])
            continue
        exists = db.scalar(select(QualityControlOrder.id).where(QualityControlOrder.title == row["title"]).limit(1))
        if exists is not None:
            continue
        db.add(QualityControlOrder(
            title=row["title"],
            product_keyword=row["product_keyword"],
            mandated_standard_id=standard.id,
            enforcement_date=_parse_date(row["enforcement_date"]),
            official_source_url=row["official_source_url"],
            verification_status=VerificationStatus(row.get("verification_status", "pending")),
            exemptions=row.get("exemptions", []),
        ))
    db.flush()
