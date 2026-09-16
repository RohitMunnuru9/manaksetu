import re
from dataclasses import dataclass

from .embeddings import cosine_similarity, semantic_index


@dataclass
class RequirementValue:
    requirement_type: str
    value: str
    confidence: float
    source_excerpt: str
    needs_confirmation: bool = True


# Literal terms, checked first. Indic entries let a Hindi or Telugu tender
# resolve its product without a translation model. These transliterations are
# the common procurement spellings and should be reviewed by a native speaker
# before the catalogue is used in production.
PRODUCT_TERMS = {
    "safety helmet": (
        "safety helmet", "industrial helmet", "protective helmet", "helmets", "helmet",
        "head protection", "protective headgear", "headgear", "hard hat",
        "हेलमेट", "सुरक्षा हेलमेट", "हेल्मेट",
        "హెల్మెట్", "భద్రతా హెల్మెట్",
    ),
    "electric cable": (
        "electric cable", "electrical cable", "power cable", "wiring", "cable",
        "केबल", "विद्युत केबल", "कैबल",
        "కేబుల్", "విద్యుత్ కేబుల్",
    ),
    "drinking water": (
        "packaged drinking water", "drinking water", "bottled water",
        "पेयजल", "पीने का पानी", "बोतलबंद पानी",
        "తాగునీరు", "తాగు నీరు",
    ),
    "safety footwear": (
        "safety footwear", "safety shoes", "protective footwear", "safety boots",
        "सुरक्षा जूते", "सुरक्षा बूट",
        "భద్రతా బూట్లు", "భద్రతా చెప్పులు",
    ),
    "cement": ("portland cement", "cement", "सीमेंट", "सिमेंट", "సిమెంట్"),
    "office furniture": (
        "office chair", "office seating", "office furniture",
        "कार्यालय फर्नीचर", "कुर्सी",
        "కార్యాలయ ఫర్నిచర్", "కుర్చీ",
    ),
}

# Glosses used only for semantic product classification, when no literal term
# matched. Written as descriptions rather than bare labels so the multilingual
# embedding has enough context to discriminate between categories.
PRODUCT_GLOSSES = {
    "safety helmet": "industrial safety helmet worn for head protection by construction and factory workers",
    "electric cable": "insulated electrical power cable and building wiring conductors",
    "drinking water": "packaged or bottled drinking water for human consumption",
    "safety footwear": "occupational safety boots and shoes with protective toecap for workers",
    "cement": "ordinary portland cement and hydraulic binder for structural concrete",
    "office furniture": "office chairs, desks and seating furniture for workplaces",
}

# Below this similarity the tender is treated as having no identifiable product,
# which is reported honestly rather than guessed at.
MIN_PRODUCT_SIMILARITY = 0.45

_gloss_vectors: dict[str, list[float]] | None = None


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

    product = _identify_product(compact, lowered)
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
    for raw in re.findall(r"\bIS\s*\d+(?:\s*\([^)]*\))?(?::\s*\d{4})?", compact, re.IGNORECASE):
        normalised = re.sub(r"\s+", " ", raw).strip().upper()
        seen.setdefault(normalised, raw)
    for normalised in sorted(seen):
        values.append(RequirementValue("existing_standard_reference", normalised, 0.97, _excerpt(compact, seen[normalised]), False))
    return values


def _identify_product(compact: str, lowered: str) -> RequirementValue | None:
    """Literal term match first, then semantic classification as a fallback.

    The literal path is deterministic and is reported as confirmed. The semantic
    path infers the product from meaning -- which is what makes a Hindi or
    Telugu tender resolve without a translation model -- and is always flagged
    for officer confirmation, because it is an inference rather than a quotation.
    """
    for product, terms in PRODUCT_TERMS.items():
        matched = next((term for term in terms if term in lowered), None)
        if matched:
            return RequirementValue("product", product, 0.9, _excerpt(compact, matched), False)

    label, similarity = _classify_product(compact)
    if label is None:
        return None
    return RequirementValue(
        requirement_type="product",
        value=label,
        confidence=round(similarity, 2),
        source_excerpt=compact[:130],
        needs_confirmation=True,
    )


def _classify_product(text: str) -> tuple[str | None, float]:
    """Nearest product gloss by embedding similarity, or (None, 0.0)."""
    global _gloss_vectors
    if not text.strip() or not semantic_index.available:
        return None, 0.0

    if _gloss_vectors is None:
        labels = list(PRODUCT_GLOSSES)
        vectors = semantic_index.embed([PRODUCT_GLOSSES[label] for label in labels])
        if vectors is None:
            return None, 0.0
        _gloss_vectors = dict(zip(labels, vectors))

    query = semantic_index.embed_one(text)
    if query is None:
        return None, 0.0

    best_label, best_score = None, 0.0
    for label, vector in _gloss_vectors.items():
        score = cosine_similarity(query, vector)
        if score > best_score:
            best_label, best_score = label, score
    if best_score < MIN_PRODUCT_SIMILARITY:
        return None, 0.0
    return best_label, best_score


def _excerpt(text: str, term: str, radius: int = 65) -> str:
    index = text.lower().find(term.lower())
    if index < 0:
        return text[: radius * 2]
    start = max(0, index - radius)
    end = min(len(text), index + len(term) + radius)
    return text[start:end].strip()
