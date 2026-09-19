"""Tests for clause traceability, the scorecard and clause drafting."""

from dataclasses import dataclass, field
from enum import Enum

from app.services.drafting import build_clauses
from app.services.scorecard import build_scorecard
from app.services.traceability import evidence_spans


TENDER = (
    "Supply of industrial safety helmets for construction workers. "
    "Quantity: 500 units. Each helmet shall pass the impact test specified by the department. "
    "Delivery within 30 days of purchase order. "
    "Payment terms as per general financial rules."
)


def test_evidence_spans_point_into_the_real_text():
    spans = evidence_spans(TENDER, ["helmet", "impact test"])
    assert spans, "matched terms must produce at least one span"
    for span in spans:
        # The offsets must address the original document exactly; highlighting
        # a paraphrase would defeat the point of traceability.
        assert TENDER[span.start:span.end].strip().startswith(span.text.split("…")[0][:40])
        assert span.terms
    strongest = max(spans, key=lambda s: len(s.terms))
    assert "impact test" in strongest.terms or "helmet" in strongest.terms


def test_evidence_spans_empty_without_terms():
    assert evidence_spans(TENDER, []) == []
    assert evidence_spans("", ["helmet"]) == []


@dataclass
class _Requirement:
    requirement_type: str
    value: str
    source_excerpt: str = ""


def test_scorecard_scores_and_fixes_are_consistent():
    requirements = [
        _Requirement("product", "safety helmet", "industrial safety helmets"),
        _Requirement("quantity", "500", "Quantity: 500 units"),
    ]
    card = build_scorecard(TENDER, requirements)
    assert 0 < card.score <= 100
    satisfied_weight = sum(row.weight for row in card.rows if row.satisfied)
    assert card.score == satisfied_weight
    # Every unsatisfied row must offer a concrete fix, and no satisfied row may.
    for row in card.rows:
        assert (row.fix is None) == row.satisfied
    # This tender cites no IS number, so the standards row must be unsatisfied.
    standards_row = next(row for row in card.rows if row.key == "standards")
    assert not standards_row.satisfied


def test_scorecard_is_deterministic():
    requirements = [_Requirement("product", "safety helmet", "helmets")]
    first = build_scorecard(TENDER, requirements)
    second = build_scorecard(TENDER, requirements)
    assert first.score == second.score
    assert [row.satisfied for row in first.rows] == [row.satisfied for row in second.rows]


class _Status(Enum):
    verified = "verified"
    pending = "pending"
    demo = "demo"


@dataclass
class _Standard:
    standard_number: str | None
    official_title: str
    verification_status: _Status = _Status.verified


@dataclass
class _Recommendation:
    standard: _Standard
    standard_type: str = "primary"
    certification_required: bool = False
    qco_title: str | None = None


def test_draft_cites_only_real_identifiers():
    recommendations = [
        _Recommendation(_Standard("IS 2925:1984", "Specification for industrial safety helmets")),
        _Recommendation(_Standard(None, "Demonstration record with no number"), standard_type="allied"),
    ]
    draft = build_clauses(recommendations, product="safety helmets", quantity="500")
    assert "IS 2925:1984" in draft.clauses
    assert "Demonstration record" not in draft.clauses
    assert draft.identifiers_used == ["IS 2925:1984"]


def test_draft_refuses_when_nothing_citable():
    recommendations = [_Recommendation(_Standard(None, "Only a demo record"))]
    draft = build_clauses(recommendations, product=None, quantity=None)
    assert draft.clauses == ""
    assert "Expert review is required" in draft.note


def test_draft_pending_records_carry_verification_caveat():
    recommendations = [
        _Recommendation(_Standard("IS 14543:2016", "Packaged Drinking Water", _Status.pending)),
    ]
    draft = build_clauses(recommendations, product="drinking water", quantity=None)
    assert "IS 14543:2016" in draft.clauses
    assert "verify against the official BIS source" in draft.clauses


def test_draft_without_qco_never_asserts_mandatory_certification():
    recommendations = [
        _Recommendation(_Standard("IS 2925:1984", "Industrial safety helmets")),
    ]
    draft = build_clauses(recommendations, product="helmets", quantity=None)
    assert "certification is not asserted as mandatory" in draft.clauses.lower()
