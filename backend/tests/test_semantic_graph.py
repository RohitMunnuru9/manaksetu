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
    """The core anti-hallucination invariant, enforced at the data layer.

    A demonstration record is invented content, so it may never carry an
    identifier. An imported record is real content awaiting confirmation, so it
    keeps its identifier and is marked pending instead.
    """
    demo = seeded_db.scalars(
        select(Standard).where(Standard.verification_status == VerificationStatus.demo)
    ).all()
    assert demo, "catalogue should contain demonstration records"
    for standard in demo:
        assert standard.standard_number is None, f"{standard.official_title} exposes an IS number while unverified"


def test_imported_records_keep_their_number_and_cite_a_source(seeded_db: Session) -> None:
    """A pending record shows a real identifier, so it must say where it came from."""
    imported = seeded_db.scalars(
        select(Standard).where(Standard.verification_status == VerificationStatus.pending)
    ).all()
    assert imported, "catalogue should contain records imported from official BIS pages"
    for standard in imported:
        assert standard.standard_number, f"{standard.official_title} is pending but has no identifier"
        assert standard.official_source_url, f"{standard.standard_number} shows a number without a source"
        assert standard.official_source_url.startswith("https://"), standard.official_source_url
        # Not yet checked by a person: that is exactly what pending means.
        assert standard.last_checked_date is None


def test_only_officer_checked_records_are_verified(seeded_db: Session) -> None:
    verified = seeded_db.scalars(
        select(Standard).where(Standard.verification_status == VerificationStatus.verified)
    ).all()
    for standard in verified:
        assert standard.standard_number and standard.official_source_url
        assert standard.last_checked_date is not None, "a verified record must record when it was checked"
        assert len(standard.content_hash or "") == 64
        # Each still needs a distinct internal handle, so the interface can name
        # it without falling back to an identical "no IS number" for every record.
        assert standard.catalogue_ref, f"{standard.official_title} has no catalogue reference"
        assert not standard.catalogue_ref.upper().startswith("IS "), "internal reference must not look like an IS number"

    refs = [item.catalogue_ref for item in seeded_db.scalars(select(Standard)).all()]
    assert len(refs) == len(set(refs)), "catalogue references must be unique"


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
