"""Local language-model explanation layer.

The model's only job is to turn retrieval evidence into readable prose for a
procurement officer. It is never the source of a fact. Two rules make that
enforceable rather than aspirational:

1. It receives only records that retrieval already produced, with their
   verification status and the deterministic certification verdict attached.
2. Its output is parsed afterwards. Any standard identifier that was not in the
   supplied evidence causes the whole explanation to be discarded, and the
   interface falls back to the deterministic reason text.

Rule 2 is what matters. A prompt instructing a model not to invent identifiers
is a request; discarding output that contains one is a guarantee.

Everything degrades safely: no Ollama, a timeout, a malformed reply or a failed
validation all result in no explanation rather than a failed analysis.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

# Matches the shapes an Indian Standard reference takes in prose: "IS 2925",
# "IS 2925:1984", "IS 2925 : 1984", "IS/ISO 1234". Deliberately broad -- a false
# positive costs a discarded explanation, a false negative costs a fabricated
# citation reaching a procurement officer.
IDENTIFIER_PATTERN = re.compile(r"\bIS(?:\s*/\s*[A-Z]{2,6})?[\s:]*\d{1,5}(?:\s*[:\-]\s*\d{4})?", re.IGNORECASE)

# Phrases asserting a legal obligation. Only the deterministic rule engine may
# make this claim, so the model saying it unprompted invalidates the output.
CERTIFICATION_CLAIMS = (
    "mandatory certification",
    "certification is mandatory",
    "compulsory certification",
    "certification is compulsory",
    "isi mark is required",
    "requires isi mark",
    "bis certification is required",
    "legally required",
)

SYSTEM_PROMPT = """You are assisting an Indian government procurement officer.

You will be given a tender description and a list of candidate records that a
retrieval system has already found. Write a short briefing about those records.

Absolute rules:
- Use ONLY the records supplied. Never mention a standard that is not listed.
- NEVER write a standard number that does not appear verbatim in the records.
  Do not complete, correct, guess or recall any IS number from memory.
- Records marked UNVERIFIED have no standard number. Refer to them by their
  title or internal reference, and say they need verification before use.
- Do not state that certification is mandatory unless a record explicitly says
  CERTIFICATION: MANDATORY. If none does, say certification status is unconfirmed.
- Do not invent test methods, dates, clauses or legal obligations.

Write 3-5 sentences of plain English. No headings, no bullet points, no preamble."""


@dataclass
class ExplanationResult:
    text: str | None = None
    status: str = "unavailable"
    model: str | None = None
    rejected_identifiers: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.text is not None


def normalise_identifier(raw: str) -> str:
    """Compare identifiers ignoring spacing and punctuation differences."""
    return re.sub(r"[^a-z0-9]", "", raw.lower())


def validate_explanation(text: str, allowed_identifiers: list[str], certification_is_mandatory: bool) -> tuple[bool, list[str]]:
    """Return (is_acceptable, offending_identifiers)."""
    permitted = {normalise_identifier(item) for item in allowed_identifiers if item}
    mentioned = IDENTIFIER_PATTERN.findall(text)
    invented = sorted({found.strip() for found in mentioned if normalise_identifier(found) not in permitted})
    if invented:
        return False, invented

    if not certification_is_mandatory:
        lowered = text.lower()
        if any(claim in lowered for claim in CERTIFICATION_CLAIMS):
            return False, []
    return True, []


def build_evidence_block(recommendations: list) -> tuple[str, list[str], bool]:
    """Render candidates as evidence lines; return the text, the identifiers the
    model is allowed to use, and whether any mandatory certification applies."""
    lines: list[str] = []
    allowed: list[str] = []
    mandatory = False

    for item in recommendations:
        standard = item.standard
        verified = standard.verification_status == "verified" and bool(standard.standard_number)
        if verified:
            identifier = standard.standard_number
            allowed.append(identifier)
            label = f"{identifier} [VERIFIED]"
        else:
            label = f"{standard.catalogue_ref or 'internal record'} [UNVERIFIED - no standard number exists for this record]"

        certification = "CERTIFICATION: MANDATORY" if item.certification_required else "CERTIFICATION: not confirmed"
        if item.certification_required:
            mandatory = True
            if item.qco_title:
                certification += f" under {item.qco_title}"

        lines.append(
            f"- {label}\n"
            f"  Title: {standard.official_title}\n"
            f"  Role: {item.standard_type}\n"
            f"  Confidence: {round(item.confidence_score * 100)}%\n"
            f"  {certification}"
        )
    return "\n".join(lines), allowed, mandatory


def warm_model() -> bool:
    """Page the weights in ahead of the first real request.

    Safe to call from a background thread at startup; a failure here only means
    the first analysis pays the cold-start cost, never that anything breaks.
    """
    settings = get_settings()
    if not settings.enable_llm_explanations or not settings.ollama_warm_on_startup:
        return False
    try:
        response = httpx.post(
            f"{settings.ollama_url.rstrip('/')}/api/generate",
            json={
                "model": settings.ollama_model,
                "prompt": "ready",
                "stream": False,
                "keep_alive": settings.ollama_keep_alive,
                "options": {"num_predict": 1},
            },
            timeout=settings.ollama_timeout_seconds,
        )
        response.raise_for_status()
        logger.info("Warmed %s; it will stay resident for %s.", settings.ollama_model, settings.ollama_keep_alive)
        return True
    except Exception as exc:
        logger.info("Could not warm %s (%s); the first analysis will load it instead.", settings.ollama_model, exc.__class__.__name__)
        return False


def explain_analysis(tender_text: str, recommendations: list, missing_requirements: list[str]) -> ExplanationResult:
    """Produce an officer-facing briefing, or nothing at all."""
    settings = get_settings()
    if not settings.enable_llm_explanations or not recommendations:
        return ExplanationResult(status="disabled" if not settings.enable_llm_explanations else "no_candidates")

    evidence, allowed, mandatory = build_evidence_block(recommendations)
    gaps = "\n".join(f"- {item}" for item in missing_requirements) or "- none detected"
    prompt = (
        f"TENDER DESCRIPTION:\n{tender_text.strip()[:1500]}\n\n"
        f"CANDIDATE RECORDS (the only standards you may mention):\n{evidence}\n\n"
        f"GAPS DETECTED IN THE TENDER:\n{gaps}\n\n"
        "Write the briefing now."
    )

    try:
        response = httpx.post(
            f"{settings.ollama_url.rstrip('/')}/api/chat",
            json={
                "model": settings.ollama_model,
                "stream": False,
                # Keep the weights resident between analyses. Ollama unloads a
                # model after five idle minutes by default, and reloading a 7B
                # model costs around forty seconds -- long enough to look broken
                # during a demonstration.
                "keep_alive": settings.ollama_keep_alive,
                # Low temperature: this is a summarisation task, not a creative one.
                "options": {"temperature": 0.2, "num_predict": 320},
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=settings.ollama_timeout_seconds,
        )
        response.raise_for_status()
        text = (response.json().get("message") or {}).get("content", "").strip()
    except httpx.TimeoutException:
        logger.warning("Ollama timed out after %ss; continuing without an explanation.", settings.ollama_timeout_seconds)
        return ExplanationResult(status="timeout")
    except httpx.HTTPError as exc:
        logger.info("Ollama unavailable (%s); continuing without an explanation.", exc.__class__.__name__)
        return ExplanationResult(status="unavailable")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Unexpected error calling Ollama: %s", exc)
        return ExplanationResult(status="error")

    if not text:
        return ExplanationResult(status="empty", model=settings.ollama_model)

    acceptable, invented = validate_explanation(text, allowed, mandatory)
    if not acceptable:
        logger.warning(
            "Discarded a model explanation: %s",
            f"invented identifiers {invented}" if invented else "unsupported certification claim",
        )
        return ExplanationResult(
            status="rejected_invented_identifier" if invented else "rejected_unsupported_claim",
            model=settings.ollama_model,
            rejected_identifiers=invented,
        )

    return ExplanationResult(text=text, status="generated", model=settings.ollama_model)
