import re
from dataclasses import dataclass

from .subject import extract_subject


@dataclass
class RequirementValue:
    requirement_type: str
    value: str
    confidence: float
    source_excerpt: str
    needs_confirmation: bool = True


# Beyond this a document is long enough that its opening matters far more than
# its bulk: a tender's subject is stated at the top, while its general
# conditions repeat unrelated words for pages.
LONG_TEXT_CHARS = 4_000

def detect_language(text: str) -> str:
    counts = {
        "hi": sum(1 for char in text if "\u0900" <= char <= "\u097f"),  # Devanagari (Hindi/Marathi)
        "te": sum(1 for char in text if "\u0c00" <= char <= "\u0c7f"),  # Telugu
        "ta": sum(1 for char in text if "\u0b80" <= char <= "\u0bff"),  # Tamil
        "bn": sum(1 for char in text if "\u0980" <= char <= "\u09ff"),  # Bengali
        "gu": sum(1 for char in text if "\u0a80" <= char <= "\u0aff"),  # Gujarati
        "pa": sum(1 for char in text if "\u0a00" <= char <= "\u0a7f"),  # Gurmukhi (Punjabi)
        "kn": sum(1 for char in text if "\u0c80" <= char <= "\u0cff"),  # Kannada
        "ml": sum(1 for char in text if "\u0d00" <= char <= "\u0d7f"),  # Malayalam
    }
    language, count = max(counts.items(), key=lambda pair: pair[1])
    return language if count >= 3 else "en"


def extract_requirements(text: str, vocabulary=None) -> list[RequirementValue]:
    compact = " ".join(text.split())
    lowered = compact.lower()
    values: list[RequirementValue] = []

    product = _identify_product(compact, vocabulary)
    if product:
        values.append(product)

    quantity = re.search(r"\b(?:quantity\s*[:\-]?\s*)?([\d,]+)\s*(?:[a-z-]+\s+){0,3}(?:units?|nos?\.?|pieces?|helmets?|pairs?|litres?|liters?)\b", compact, re.IGNORECASE)
    if quantity:
        values.append(RequirementValue("quantity", quantity.group(1).replace(",", ""), 0.92, _excerpt(compact, quantity.group(0)), False))

    uses = [("construction site", ("construction", "building site")), ("industrial workplace", ("industrial", "factory", "workplace")), ("fire service", ("firemen", "fire service"))]
    for value, terms in uses:
        matched = next((term for term in terms if term in lowered), None)
        if matched:
            values.append(RequirementValue("intended_use", value, 0.82, _excerpt(compact, matched)))
            break

    feature_groups = {
        "testing": ("impact test", "impact testing", "penetration test", "test certificate", "acceptance test"),
        "marking": ("permanent marking", "marking", "traceability"),
        "safety": ("safety", "protective", "protection"),
        "warranty": ("warranty", "guarantee"),
        "environment": ("temperature", "humidity", "weather", "environmental"),
    }
    for requirement_type, terms in feature_groups.items():
        matched = [term for term in terms if term in lowered]
        if matched:
            values.append(RequirementValue(requirement_type, ", ".join(matched[:3]), 0.78, _excerpt(compact, matched[0])))

    # Normalise before de-duplicating. Collapsing the raw matches first let
    # "IS 1892" and "is  1892" survive as two entries that became identical once
    # uppercased, which then collided as duplicate keys in the interface.
    seen: dict[str, str] = {}
    # At least three digits: a bare "IS 10" is nearly always a fragment of
    # running text rather than a citation, and a wrong citation shown to an
    # officer is worse than a missed one.
    for raw in re.findall(r"\bIS\s*\d{3,5}(?:\s*\([^)]*\))?(?::\s*\d{4})?", compact, re.IGNORECASE):
        # "(PART-3)" and "(PART 3)" are the same citation written two ways: the
        # separator varies between documents, the standard does not.
        normalised = re.sub(r"[\s\-]+", " ", raw).strip().upper()
        seen.setdefault(normalised, raw)
    for normalised in sorted(seen):
        values.append(RequirementValue("existing_standard_reference", normalised, 0.97, _excerpt(compact, seen[normalised]), False))
    return values


def _identify_product(compact: str, vocabulary=None) -> RequirementValue | None:
    """What the tender is for, taken from the tender.

    There is no list of known products here, and deliberately so. The previous
    implementation chose between six hardcoded categories by counting mentions,
    which meant a notice for blood bank incubators was reported as "electric
    cable": the phrase appeared forty-six times in the general conditions while
    the actual subject was stated once, at the top, where it always is.

    The subject line is the answer. Retrieval then searches the whole catalogue
    for it, so the range of products the system can handle is the range the
    catalogue covers -- not a list someone remembered to write down.
    """
    subject = extract_subject(compact, vocabulary)
    if not subject.found:
        return None
    return RequirementValue(
        requirement_type="product",
        value=subject.text,
        confidence=0.9 if subject.source == "stated" else 0.6,
        source_excerpt=subject.excerpt or compact[:160],
        needs_confirmation=subject.needs_confirmation,
    )


def _excerpt(text: str, term: str, radius: int = 65) -> str:
    index = text.lower().find(term.lower())
    if index < 0:
        return text[: radius * 2]
    start = max(0, index - radius)
    end = min(len(text), index + len(term) + radius)
    return text[start:end].strip()
