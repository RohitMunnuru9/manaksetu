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


# --- Validation messages an officer can act on -------------------------------

from app.main import _readable


def test_validation_messages_name_the_field_and_the_fix():
    """Pydantic's own wording is written for developers. An officer sees
    whatever the API returns, so it has to be a sentence about the box they
    filled in."""
    assert _readable({"type": "missing", "loc": ["body", "description"]}) == "Please fill in the description."

    short = _readable({"type": "string_too_short", "loc": ["body", "title"], "ctx": {"min_length": 3}})
    assert "short title" in short and "3" in short

    long = _readable({"type": "string_too_long", "loc": ["body", "description"], "ctx": {"max_length": 600000}})
    assert "too long" in long.lower()
    # It has to say what to do instead, not merely that the input was refused.
    assert "upload" in long.lower()

    # An unrecognised failure still produces a sentence, never a raw type name.
    odd = _readable({"type": "some_future_pydantic_rule", "loc": ["body", "title"]})
    assert odd.endswith(".") and "some_future" not in odd


def test_typed_and_uploaded_tenders_share_one_length_limit():
    """A tender that can be uploaded must also be pasteable. These were 600,000
    and 50,000, so pasting the same document was refused for no reason the
    officer could see."""
    from app.schemas import TenderCreate
    from app.services.documents import MAX_TEXT_CHARS

    typed_limit = TenderCreate.model_fields["description"].metadata[-1].max_length
    assert typed_limit == MAX_TEXT_CHARS
