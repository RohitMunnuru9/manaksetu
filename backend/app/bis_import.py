"""Import the harvested official BIS catalogue into the database.

Runs at startup after the curated seed, and is idempotent: a record is keyed by
its official standard number, curated records always win over harvested ones,
and a second start with the same harvest file does nothing.

Every imported record enters as verification tier "pending": a real number,
taken from the official BIS catalogue service, that no officer has individually
confirmed. It is never presented as verified — that promotion is a human action
in the review screen, exactly as for the hand-curated records.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ProductCategory, Standard, StandardStatus, VerificationStatus
from .services.embeddings import semantic_index, standard_document

logger = logging.getLogger(__name__)

HARVEST_PATH = Path(__file__).resolve().parent / "data" / "bis_harvest.json"

# Embedding happens in slices so a crash mid-import loses minutes, not the run.
EMBED_BATCH = 256


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.strptime(value[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def import_bis_harvest(db: Session) -> int:
    """Load bis_harvest.json if present. Returns how many records were added."""
    if not HARVEST_PATH.exists():
        return 0

    with HARVEST_PATH.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    records = payload.get("records") or []
    if not records:
        return 0

    harvested_on = _parse_date(payload.get("_harvested_on"))
    today = date.today()

    existing_numbers = {
        number
        for (number,) in db.execute(select(Standard.standard_number).where(Standard.standard_number.isnot(None)))
    }
    categories: dict[str, ProductCategory] = {
        category.name: category for category in db.scalars(select(ProductCategory))
    }

    added: list[Standard] = []
    for row in records:
        number = (row.get("standard_number") or "").strip()
        title = (row.get("title") or "").strip()
        if not number or not title or number in existing_numbers:
            continue  # curated records win; nothing without an identifier enters here

        sector = (row.get("sectors") or ["Uncategorised"])[0].strip() or "Uncategorised"
        category = categories.get(sector)
        if category is None:
            category = ProductCategory(name=sector, description="Sector from the official BIS catalogue.")
            db.add(category)
            db.flush()
            categories[sector] = category

        valid_upto = _parse_date(row.get("valid_upto"))
        published = _parse_date(row.get("published_on"))
        standard = Standard(
            standard_number=number,
            catalogue_ref=f"BIS-{row.get('bis_standard_id')}" if row.get("bis_standard_id") else None,
            official_title=title[:500],
            scope_summary=(row.get("title") or "")[:2000],
            publication_year=published.year if published else _year_from_number(number),
            # The catalogue lists what BIS currently publishes; a lapsed validity
            # date is a fact worth surfacing, not a guess.
            status=(
                StandardStatus.current
                if valid_upto is None or valid_upto >= today
                else StandardStatus.uncertain
            ),
            official_source_url="https://standards.bis.gov.in/website/catalogue-list",
            source_organisation="Bureau of Indian Standards",
            retrieved_date=harvested_on,
            last_checked_date=harvested_on,
            verification_status=VerificationStatus.pending,
            category_id=category.id,
            valid_until=valid_upto,
            bis_sector=sector,
        )
        db.add(standard)
        added.append(standard)
        existing_numbers.add(number)

    if not added:
        return 0
    db.flush()
    _embed(db, added)
    db.commit()
    logger.info("Imported %d standards from the official BIS catalogue harvest.", len(added))
    return len(added)


def _year_from_number(number: str) -> int | None:
    """'IS 2925:1984' -> 1984. The year suffix is part of the official citation."""
    tail = number.rsplit(":", 1)
    if len(tail) == 2 and tail[1].strip().isdigit() and len(tail[1].strip()) == 4:
        return int(tail[1].strip())
    return None


def _embed(db: Session, standards: list[Standard]) -> None:
    if not semantic_index.available:
        logger.warning("Embedding model unavailable; BIS import will be lexical-only until next start.")
        return
    for start in range(0, len(standards), EMBED_BATCH):
        batch = standards[start : start + EMBED_BATCH]
        documents = [standard_document(item.official_title, item.scope_summary) for item in batch]
        vectors = semantic_index.embed(documents)
        if vectors is None:
            return
        for standard, vector in zip(batch, vectors):
            standard.embedding = vector
        db.flush()
        logger.info("Embedded %d/%d harvested records.", min(start + EMBED_BATCH, len(standards)), len(standards))
