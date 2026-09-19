"""Specification scorecard: a deterministic pre-publication quality check.

Scores a tender specification against the checklist a well-formed procurement
specification is expected to satisfy, and says specifically what to add. No
model is involved: every row is a keyword test over the officer's own text, so
the same document always produces the same score, and every finding can be
traced to the exact wording (or absence) that caused it.

The score is advisory. It measures completeness of the specification document,
not the quality of the goods -- a fact the interface is expected to repeat.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# Each dimension: weight, the terms that satisfy it, and the concrete fix
# offered when it is absent. Weights sum to 100 for readability.
_DIMENSIONS: list[dict] = [
    {
        "key": "product",
        "label": "Product clearly identified",
        "weight": 20,
        "fix": "Name the product explicitly, ideally in the opening sentence.",
    },
    {
        "key": "quantity",
        "label": "Quantity stated",
        "weight": 10,
        "terms": (),  # satisfied via extracted requirements
        "fix": "State the quantity with a unit (units, pairs, litres…).",
    },
    {
        "key": "standards",
        "label": "Indian Standards cited",
        "weight": 15,
        "fix": "Cite the applicable IS numbers, including the year (e.g. IS 2925:1984).",
    },
    {
        "key": "testing",
        "label": "Measurable acceptance or test criteria",
        "weight": 15,
        "terms": ("test", "acceptance", "threshold", "criteria", "inspection", "sample"),
        "fix": "Add pass/fail acceptance criteria and who performs the test.",
    },
    {
        "key": "certification",
        "label": "Certification or marking requirement",
        "weight": 10,
        "terms": ("certification", "certificate", "isi mark", "bis licence", "bis license", "marking", "marked"),
        "fix": "Say whether ISI/BIS certification is required and how it is evidenced.",
    },
    {
        "key": "environment",
        "label": "Operating or environmental conditions",
        "weight": 10,
        "terms": ("temperature", "humidity", "environment", "weather", "outdoor", "indoor", "corrosion"),
        "fix": "Describe the conditions the product must survive in service.",
    },
    {
        "key": "warranty",
        "label": "Warranty or service requirement",
        "weight": 10,
        "terms": ("warranty", "guarantee", "service", "maintenance", "defect liability"),
        "fix": "State the warranty period and what it covers.",
    },
    {
        "key": "delivery",
        "label": "Delivery or timeline stated",
        "weight": 10,
        "terms": ("delivery", "deliver", "within", "days", "weeks", "months", "schedule", "timeline"),
        "fix": "Give a delivery period or schedule.",
    },
]

_CITATION = re.compile(r"\bIS\s*\d{3,5}", re.IGNORECASE)


@dataclass
class ScoreRow:
    key: str
    label: str
    weight: int
    satisfied: bool
    evidence: str | None = None
    fix: str | None = None


@dataclass
class Scorecard:
    score: int
    grade: str
    rows: list[ScoreRow] = field(default_factory=list)
    fixes: list[str] = field(default_factory=list)

    @property
    def satisfied(self) -> int:
        return sum(1 for row in self.rows if row.satisfied)


def _grade(score: int) -> str:
    if score >= 85:
        return "ready"
    if score >= 60:
        return "needs work"
    return "incomplete"


def _excerpt(text: str, term: str, radius: int = 60) -> str | None:
    index = text.lower().find(term.lower())
    if index < 0:
        return None
    start = max(0, index - radius)
    end = min(len(text), index + len(term) + radius)
    return text[start:end].strip()


def build_scorecard(text: str, requirements: list) -> Scorecard:
    """`requirements` is the extracted-requirement list from the analysis, used
    for the dimensions that already have a stronger detector than keywords."""
    compact = " ".join(text.split())
    lowered = compact.lower()
    extracted = {item.requirement_type: item for item in requirements}

    rows: list[ScoreRow] = []
    total = 0
    for dimension in _DIMENSIONS:
        key = dimension["key"]
        satisfied = False
        evidence: str | None = None

        if key == "product":
            item = extracted.get("product")
            if item is not None:
                satisfied = True
                evidence = item.source_excerpt or item.value
        elif key == "quantity":
            item = extracted.get("quantity")
            if item is not None:
                satisfied = True
                evidence = item.source_excerpt or item.value
        elif key == "standards":
            match = _CITATION.search(compact)
            if match:
                satisfied = True
                evidence = _excerpt(compact, match.group(0))
        else:
            for term in dimension.get("terms", ()):
                if term in lowered:
                    satisfied = True
                    evidence = _excerpt(compact, term)
                    break

        rows.append(
            ScoreRow(
                key=key,
                label=dimension["label"],
                weight=dimension["weight"],
                satisfied=satisfied,
                evidence=evidence,
                fix=None if satisfied else dimension["fix"],
            )
        )
        if satisfied:
            total += dimension["weight"]

    return Scorecard(
        score=total,
        grade=_grade(total),
        rows=rows,
        fixes=[row.fix for row in rows if row.fix],
    )
