import re
from dataclasses import dataclass


@dataclass
class RequirementValue:
    requirement_type: str
    value: str
    confidence: float
    source_excerpt: str
    needs_confirmation: bool = True


PRODUCT_TERMS = {
    "safety helmet": ("safety helmet", "industrial helmet", "protective helmet", "helmets"),
    "electric cable": ("electric cable", "electrical cable", "power cable"),
    "drinking water": ("packaged drinking water", "drinking water"),
    "safety footwear": ("safety footwear", "safety shoes", "protective footwear"),
}


def detect_language(text: str) -> str:
    counts = {
        "hi": sum(1 for char in text if "\u0900" <= char <= "\u097f"),
        "te": sum(1 for char in text if "\u0c00" <= char <= "\u0c7f"),
    }
    language, count = max(counts.items(), key=lambda pair: pair[1])
    return language if count >= 3 else "en"


def extract_requirements(text: str) -> list[RequirementValue]:
    compact = " ".join(text.split())
    lowered = compact.lower()
    values: list[RequirementValue] = []

    for product, terms in PRODUCT_TERMS.items():
        matched = next((term for term in terms if term in lowered), None)
        if matched:
            values.append(RequirementValue("product", product, 0.9, _excerpt(compact, matched), False))
            break

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

    for standard in sorted(set(re.findall(r"\bIS\s*\d+(?:\s*\([^)]*\))?(?::\s*\d{4})?", compact, re.IGNORECASE))):
        values.append(RequirementValue("existing_standard_reference", standard.upper(), 0.97, _excerpt(compact, standard), False))
    return values


def _excerpt(text: str, term: str, radius: int = 65) -> str:
    index = text.lower().find(term.lower())
    if index < 0:
        return text[: radius * 2]
    start = max(0, index - radius)
    end = min(len(text), index + len(term) + radius)
    return text[start:end].strip()
