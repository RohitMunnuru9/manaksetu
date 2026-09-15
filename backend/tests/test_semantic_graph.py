"""Tests for hybrid retrieval and graph traversal.

These lock in the two claims the prototype actually makes: that retrieval finds
a standard whose wording does not appear in the tender, and that doing so never
weakens the verification and certification guardrails.
"""

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Standard, StandardRelationship, VerificationStatus
from app.seed import seed_demo_data
from app.services.embeddings import semantic_index
from app.services.recommendation import apply_graph_context, find_candidates


@pytest.fixture(scope="module")
def seeded_db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = Session(engine)
    seed_demo_data(db)
    return db


needs_model = pytest.mark.skipif(
    not semantic_index.available,
    reason="embedding model unavailable; hybrid retrieval falls back to lexical",
)


def test_catalogue_seeds_relationships_and_embeddings(seeded_db: Session) -> None:
    standards = seeded_db.scalars(select(Standard)).all()
    assert len(standards) >= 10
    edges = seeded_db.scalars(select(StandardRelationship)).all()
    assert edges, "catalogue should define at least one standards relationship"


def test_demo_records_never_carry_a_standard_number(seeded_db: Session) -> None:
    """The core anti-hallucination invariant, enforced at the data layer."""
    demo = seeded_db.scalars(
        select(Standard).where(Standard.verification_status != VerificationStatus.verified)
    ).all()
    assert demo, "catalogue should contain demonstration records"
    for standard in demo:
        assert standard.standard_number is None, f"{standard.official_title} exposes an IS number while unverified"


@needs_model
def test_semantic_retrieval_finds_record_with_no_shared_keywords(seeded_db: Session) -> None:
    """'head protection gear for labourers' must reach 'industrial safety helmets'."""
    query = "Procurement of head protection gear for labourers working at elevated building sites."
    results = find_candidates(seeded_db, query)
    assert results, "hybrid retrieval returned nothing"
    top = results[0].standard
    assert top.standard_number == "IS 2925:1984"
    # The point of the test: the match is not explained by literal overlap.
    assert "helmet" not in query.lower()
    assert results[0].semantic_score > results[0].lexical_score


@needs_model
def test_unrelated_query_does_not_return_helmet_records(seeded_db: Session) -> None:
    results = find_candidates(seeded_db, "Supply of bottled water for office consumption.")
    titles = " ".join(item.standard.official_title.lower() for item in results)
    assert "helmet" not in titles


@needs_model
def test_query_with_no_plausible_match_returns_nothing(seeded_db: Session) -> None:
    """Feeds the 'No verified recommendation found' guardrail rather than guessing."""
    results = find_candidates(seeded_db, "Procurement of artisanal sourdough starter cultures for the canteen.")
    assert results == []


def test_graph_context_labels_allied_standards(seeded_db: Session) -> None:
    primary = seeded_db.scalar(select(Standard).where(Standard.standard_number == "IS 2925:1984"))
    assert primary is not None
    from app.services.recommendation import RankedStandard

    candidates = [RankedStandard(standard=primary, score=0.72, matched_terms=["helmet"])]
    expanded = apply_graph_context(seeded_db, candidates)

    assert len(expanded) > 1, "graph traversal should add allied standards"
    allied = expanded[1:]
    assert all(item.relation_note for item in allied), "every graph-derived result needs its edge recorded"
    assert {"test", "safety", "terminology"} & {item.standard_type for item in allied}


def test_graph_derived_records_stay_below_the_unverified_ceiling(seeded_db: Session) -> None:
    """A graph edge is a reason to show a record, never a reason to trust it."""
    primary = seeded_db.scalar(select(Standard).where(Standard.standard_number == "IS 2925:1984"))
    from app.services.recommendation import RankedStandard, UNVERIFIED_SCORE_CEILING

    expanded = apply_graph_context(seeded_db, [RankedStandard(standard=primary, score=0.72, matched_terms=[])])
    for item in expanded[1:]:
        if item.standard.verification_status != VerificationStatus.verified:
            assert item.score <= UNVERIFIED_SCORE_CEILING
