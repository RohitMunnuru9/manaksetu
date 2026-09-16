"""Version, amendment and supersession checking.

Deterministic, like the QCO engine. A standard's currency is a matter of record,
not of judgement, so nothing here consults a language model.

Two distinct problems are detected:

1. A *recommended* record that is itself revised or withdrawn, which the officer
   must not cite even though retrieval matched it.
2. A standard number the *tender already cites* that the catalogue knows to be
   superseded -- the case where an officer has copied a clause from an older
   document and needs telling.
"""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Standard, StandardStatus, VerificationStatus

# Same shape the requirement extractor looks for in tender text.
CITATION_PATTERN = re.compile(r"\bIS\s*\d{1,5}(?:\s*[:\-]\s*\d{4})?", re.IGNORECASE)

OUTDATED_STATUSES = {StandardStatus.revised, StandardStatus.withdrawn}


def normalise_citation(raw: str) -> str:
    return re.sub(r"[^a-z0-9]", "", raw.lower())


def describe_currency(standard: Standard) -> dict:
    """Currency facts for a single record, safe to show beside a recommendation."""
    replacement = standard.superseded_by
    amendments = [
        {
            "amendment_number": item.amendment_number,
            "issued_date": item.issued_date.isoformat() if item.issued_date else None,
            "summary": item.summary,
            "official_source_url": item.official_source_url,
        }
        for item in sorted(standard.amendments, key=lambda a: a.amendment_number)
    ]

    outdated = standard.status in OUTDATED_STATUSES
    warning = None
    if outdated:
        label = "withdrawn" if standard.status == StandardStatus.withdrawn else "revised"
        if replacement is not None:
            successor = replacement.standard_number or replacement.catalogue_ref or replacement.official_title
            warning = f"This record is {label} and has been superseded by {successor}. Cite the current record instead."
        else:
            warning = f"This record is {label}. Confirm the current version against the official BIS catalogue before citing it."
    elif amendments:
        count = len(amendments)
        warning = (
            f"{count} amendment{'' if count == 1 else 's'} issued against this standard. "
            "A tender citing the base number alone may omit the amended requirements."
        )

    return {
        "status": standard.status.value,
        "is_outdated": outdated,
        "amendments": amendments,
        "superseded_by": (replacement.standard_number or replacement.catalogue_ref) if replacement else None,
        "currency_warning": warning,
    }


def outdated_citations(db: Session, tender_text: str) -> list[dict]:
    """Standards the tender itself cites that the catalogue knows are outdated.

    Only verified records can be matched here: an unverified record has no
    standard number, so it can never be what a tender cited.
    """
    cited = {normalise_citation(match) for match in CITATION_PATTERN.findall(tender_text)}
    if not cited:
        return []

    findings: list[dict] = []
    candidates = db.scalars(
        select(Standard).where(
            Standard.standard_number.isnot(None),
            Standard.verification_status == VerificationStatus.verified,
        )
    ).all()

    for standard in candidates:
        number = standard.standard_number or ""
        # Match the base number so "IS 2925" in a tender still matches the
        # catalogue's "IS 2925:1984" record.
        base = normalise_citation(number.split(":")[0])
        if not (normalise_citation(number) in cited or base in cited):
            continue
        currency = describe_currency(standard)
        if currency["is_outdated"] or currency["amendments"]:
            findings.append({
                "cited_standard": number,
                "status": currency["status"],
                "superseded_by": currency["superseded_by"],
                "amendment_count": len(currency["amendments"]),
                "message": currency["currency_warning"],
            })
    return findings
