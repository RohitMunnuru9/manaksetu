"""Draft specification clauses grounded in the retrieved standards.

Turns an analysis into text an officer can paste into a tender: a standards
clause, a certification clause when the rule engine found a Quality Control
Order, and a testing clause. Two layers:

1. A deterministic template, built only from retrieved records. This always
   works, offline, and is the text of record.
2. An optional local-model rewrite for fluency, validated by the same rule as
   the briefing: any standard identifier in the output that was not in the
   retrieved evidence discards the rewrite, and the deterministic text stands.

So the model can improve the wording but can never change the substance -- the
clause a procurement officer copies is grounded in retrieval, not generation.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import httpx

from ..config import get_settings
from .explanation import validate_explanation

logger = logging.getLogger(__name__)

REWRITE_PROMPT = """You are rewriting procurement clause drafts for an Indian government tender.
Rewrite the clauses below into polished, formal tender language.

Absolute rules:
- Keep every standard number EXACTLY as written. Never add, complete or correct one.
- Do not add certification claims that are not in the draft.
- Do not add new technical requirements, dates or legal obligations.
- Keep the same clause structure and numbering.

Return only the rewritten clauses, no preamble."""


@dataclass
class DraftClauses:
    clauses: str
    source: str = "deterministic"  # or the model name when a rewrite passed validation
    identifiers_used: list[str] = field(default_factory=list)
    note: str = ""


def _tiered_reference(item) -> str | None:
    """How a record may be cited in a draft. Records without a real standard
    number are never cited in clause text at all -- a draft clause naming an
    internal demo reference would defeat the point of the whole system."""
    standard = item.standard
    if not standard.standard_number:
        return None
    suffix = ""
    if standard.verification_status.value == "pending":
        suffix = " (verify against the official BIS source before publication)"
    return f"{standard.standard_number}, {standard.official_title}{suffix}"


def build_clauses(recommendations: list, product: str | None, quantity: str | None) -> DraftClauses:
    """The deterministic draft. Only retrieved records with real numbers appear."""
    primary = [item for item in recommendations if item.standard.standard_number]
    if not primary:
        return DraftClauses(
            clauses="",
            note=(
                "No record with a verified or officially imported standard number was "
                "retrieved for this tender, so no clause can honestly be drafted. "
                "Expert review is required."
            ),
        )

    identifiers = [item.standard.standard_number for item in primary]
    subject = product or "goods"
    lines: list[str] = []

    lines.append("1. STANDARDS COMPLIANCE")
    lines.append(
        f"   The {subject} supplied shall conform to the following Indian Standards, "
        "including all amendments in force on the date of bid submission:"
    )
    for item in primary:
        reference = _tiered_reference(item)
        if reference:
            role = "" if item.standard_type == "primary" else f" [{item.standard_type}]"
            lines.append(f"   - {reference}{role}")

    certification = [item for item in primary if item.certification_required]
    lines.append("")
    lines.append("2. CERTIFICATION AND MARKING")
    if certification:
        first = certification[0]
        order = f" under {first.qco_title}" if first.qco_title else ""
        lines.append(
            f"   BIS certification is mandatory for {subject}{order}. Each unit shall "
            "bear the Standard Mark, and the bidder shall submit a valid BIS licence "
            "with the bid."
        )
    else:
        lines.append(
            "   No Quality Control Order matching this product was found in the "
            "rule register, so certification is not asserted as mandatory here. "
            "The officer must confirm certification requirements before publication."
        )

    lines.append("")
    lines.append("3. INSPECTION AND TESTING")
    lines.append(
        "   Acceptance shall be against the test methods prescribed in the standards "
        "cited in Clause 1. Test certificates from a laboratory acceptable to the "
        "purchaser shall accompany each delivered lot"
        + (f" (quantity: {quantity})" if quantity else "")
        + "."
    )

    return DraftClauses(clauses="\n".join(lines), identifiers_used=identifiers)


def polish_clauses(draft: DraftClauses, certification_is_mandatory: bool) -> DraftClauses:
    """Optional local-model rewrite. Falls back to the deterministic draft on
    any failure or validation rejection -- the caller cannot tell the difference
    except by the `source` field, which the interface shows honestly."""
    settings = get_settings()
    if not settings.enable_llm_explanations or not draft.clauses:
        return draft
    try:
        response = httpx.post(
            f"{settings.ollama_url.rstrip('/')}/api/chat",
            json={
                "model": settings.ollama_model,
                "stream": False,
                "keep_alive": settings.ollama_keep_alive,
                "options": {"temperature": 0.2, "num_predict": 400},
                "messages": [
                    {"role": "system", "content": REWRITE_PROMPT},
                    {"role": "user", "content": draft.clauses},
                ],
            },
            timeout=settings.ollama_timeout_seconds,
        )
        response.raise_for_status()
        text = (response.json().get("message") or {}).get("content", "").strip()
    except Exception as exc:  # noqa: BLE001 - degrade to the deterministic draft
        logger.info("Clause rewrite unavailable (%s); deterministic draft stands.", exc.__class__.__name__)
        return draft

    if not text:
        return draft
    acceptable, invented = validate_explanation(text, draft.identifiers_used, certification_is_mandatory)
    if not acceptable:
        logger.warning("Discarded clause rewrite: invented %s", invented or "certification claim")
        return draft
    return DraftClauses(
        clauses=text,
        source=settings.ollama_model,
        identifiers_used=draft.identifiers_used,
        note="Polished by the local model; every identifier validated against retrieval.",
    )
