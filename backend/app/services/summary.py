"""The document at a glance: a deterministic explanation of the uploaded tender.

The model briefing is prose, arrives after tens of seconds, and can be
discarded by validation. This layer is neither: it is assembled directly from
what extraction actually found, it renders instantly with the results, and it
cannot say anything the pipeline does not know. Together they make the summary
panel: facts first, narrative on top.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# How a requirement type reads to a person, in the order worth reading them.
_FEATURE_LABELS = [
    ("testing", "Testing asked for"),
    ("marking", "Marking asked for"),
    ("safety", "Safety wording"),
    ("warranty", "Warranty"),
    ("environment", "Operating conditions"),
]

LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "te": "Telugu", "ta": "Tamil", "bn": "Bengali",
    "mr": "Marathi", "gu": "Gujarati", "pa": "Punjabi", "kn": "Kannada", "ml": "Malayalam",
}


@dataclass
class GlancePoint:
    label: str
    value: str
    tone: str = "plain"  # plain | good | warn


def _requirement_map(requirements: list) -> dict[str, list]:
    grouped: dict[str, list] = {}
    for item in requirements:
        grouped.setdefault(item.requirement_type, []).append(item)
    return grouped


def document_glance(
    *,
    language: str,
    filename: str | None,
    text_length: int,
    requirements: list,
    recommendations: list,
    missing: list[str],
    outdated_count: int = 0,
) -> list[GlancePoint]:
    grouped = _requirement_map(requirements)
    points: list[GlancePoint] = []

    # What the document is. Uploads are stored under a UUID prefix that means
    # nothing to the officer, so show the name they actually uploaded.
    source = re.sub(r"^[0-9a-f]{32}_", "", filename) if filename else "typed description"
    language_name = LANGUAGE_NAMES.get(language, language.upper())
    points.append(GlancePoint("The document", f"{source} — {text_length:,} characters, read in {language_name}."))

    # What is being bought.
    product = grouped.get("product", [None])[0]
    if product is not None:
        confidence = "" if not product.needs_confirmation else " (our reading — please confirm)"
        points.append(GlancePoint("What is being bought", f"{product.value}{confidence}", "good"))
    else:
        points.append(GlancePoint("What is being bought", "Not identifiable from the text — the results below rely on wording alone.", "warn"))

    quantity = grouped.get("quantity", [None])[0]
    if quantity is not None:
        points.append(GlancePoint("How much", quantity.value))
    use = grouped.get("intended_use", [None])[0]
    if use is not None:
        points.append(GlancePoint("Where it will be used", use.value))

    # The requirements the document itself states.
    stated = [f"{label.lower()}: {items[0].value}" for key, label in _FEATURE_LABELS if (items := grouped.get(key))]
    if stated:
        points.append(GlancePoint("Requirements stated in it", "; ".join(stated)))

    citations = [item.value for item in grouped.get("existing_standard_reference", [])]
    if citations:
        shown = ", ".join(citations[:6]) + ("…" if len(citations) > 6 else "")
        tone = "warn" if outdated_count else "plain"
        suffix = f" — {outdated_count} outdated" if outdated_count else ""
        points.append(GlancePoint("Standards it already cites", shown + suffix, tone))

    # What the system proposes.
    with_numbers = [item for item in recommendations if item.standard.standard_number]
    if with_numbers:
        top = with_numbers[0]
        others = len(with_numbers) - 1
        tail = f" and {others} related record{'s' if others != 1 else ''}" if others else ""
        points.append(GlancePoint("Standards that apply", f"{top.standard.standard_number} ({top.standard.official_title[:60]}){tail}.", "good"))
    else:
        points.append(GlancePoint("Standards that apply", "No verified recommendation found. Expert review is required.", "warn"))

    if any(item.certification_required for item in recommendations):
        order = next((item.qco_title for item in recommendations if item.certification_required and item.qco_title), None)
        points.append(GlancePoint("Certification", f"BIS certification is mandatory{f' under {order}' if order else ''}.", "warn"))

    # What is missing.
    if missing:
        points.append(GlancePoint("Before publishing", "; ".join(missing[:3]) + ("…" if len(missing) > 3 else ""), "warn"))
    else:
        points.append(GlancePoint("Before publishing", "The usual specification points are all present.", "good"))

    return points
