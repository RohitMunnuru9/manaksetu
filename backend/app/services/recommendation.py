import re
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import QualityControlOrder, Standard, StandardRelationship, VerificationStatus
from .embeddings import cosine_similarity, semantic_index, standard_document


TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9-]{2,}")
STOP_WORDS = {"and", "the", "for", "with", "from", "that", "this", "units", "purchase", "supply"}

# A real 233-page tender yields several thousand distinct words. One SQL clause
# per word overran SQLite's expression-tree limit and the upload failed outright,
# and a lexical score divided by thousands of terms is meaningless anyway. The
# words a document repeats are the ones that characterise it, so the most
# frequent are kept and the long tail dropped.
MAX_QUERY_TERMS = 80

# Above this length a document is summarised by its repeated words rather than
# read from the top. The embedding model only sees its first few hundred tokens,
# which on a 233-page tender is the cover page and proprietary notice -- that
# scored 0.45 against the catalogue and returned nothing, while the same
# document's frequent terms scored 0.59 and reached the right category.
LONG_DOCUMENT_CHARS = 4_000

# Prototype weights. These are starting values, not validated coefficients --
# they must be tuned against an expert-labelled dataset before any claim is made
# about ranking quality.
WEIGHT_SEMANTIC = 0.45
WEIGHT_LEXICAL = 0.35
# Applied as multipliers on relevance, not as additions to it, so evidence
# quality can order two similar matches without inventing a match.
TRUST_VERIFIED = 0.30
TRUST_FRESHNESS = 0.08

# An unverified record can never present as high confidence, regardless of how
# well it matches. This is the ranking half of the anti-hallucination rule.
UNVERIFIED_SCORE_CEILING = 0.69

# Semantic floor for keeping a candidate. Incidental lexical overlap ("building",
# "working") drags unrelated records into a result set; their embedding
# similarity stays far below this, so it is the more reliable filter. Applied
# only when the embedding model actually loaded.
#
# Measured against this catalogue rather than guessed. Tenders whose product is
# genuinely present score 0.56 to 0.90; tenders for products that are absent
# peak at 0.50 -- solar panels reaching PVC cables at 0.41, water pumps reaching
# packaged drinking water at 0.48. The floor sits in the gap between those two
# ranges, because a confidently wrong standard in a tender is far worse than
# being told the catalogue does not cover the purchase.
#
# Re-measure this if the catalogue grows substantially: a denser catalogue
# raises the similarity of near-misses, and the gap will move.
MIN_SEMANTIC_RELEVANCE = 0.52

# A graph-linked record scores this fraction of the primary it hangs off. It is
# included because of a modelled relationship, so it inherits the primary's
# relevance rather than asserting one of its own.
GRAPH_RELATIVE_SCORE = 0.85

# How a graph edge maps onto the standard_type shown to the officer.
RELATIONSHIP_TYPES = {
    "references": "normative reference",
    "tested_by": "test",
    "safety": "safety",
    "installation": "installation",
    "terminology": "terminology",
}


@dataclass
class RankedStandard:
    standard: Standard
    score: float
    matched_terms: list[str]
    lexical_score: float = 0.0
    semantic_score: float = 0.0
    standard_type: str = "primary"
    relation_note: str | None = None
    reason: str = ""
    breakdown: dict[str, float] = field(default_factory=dict)


def extract_terms(text: str) -> list[str]:
    """The words worth searching on, most frequent first, capped."""
    counts: dict[str, int] = {}
    for match in TOKEN_RE.finditer(text):
        word = match.group(0).lower()
        if word not in STOP_WORDS:
            counts[word] = counts.get(word, 0) + 1
    if len(counts) <= MAX_QUERY_TERMS:
        return sorted(counts)
    # Frequency first, then alphabetically so the result is stable run to run.
    ranked = sorted(counts, key=lambda w: (-counts[w], w))[:MAX_QUERY_TERMS]
    return sorted(ranked)


def retrieval_mode() -> str:
    """Reported to the client so the UI never overstates what ran."""
    return "hybrid" if semantic_index.available else "lexical"


def _lexical_candidates(db: Session, terms: list[str]) -> list[Standard]:
    if not terms:
        return []
    clauses = [Standard.official_title.ilike(f"%{term}%") for term in terms]
    clauses += [Standard.scope_summary.ilike(f"%{term}%") for term in terms]
    return list(db.scalars(select(Standard).where(or_(*clauses))).all())


def _score(standard: Standard, lexical: float, semantic: float) -> tuple[float, dict[str, float]]:
    """Relevance first, then trust as a multiplier on it.

    Being verified is a statement about evidence, not about how well a record
    answers this tender, so it must not manufacture relevance. Adding it as a
    flat bonus did exactly that: on a footwear tender the verified helmet
    standard scored 0.36 of relevance plus 0.20 of trust and beat the footwear
    standard's 0.53 of relevance. Multiplying instead lets a clearly better match
    win, while still preferring the verified record between two close ones.
    """
    verified = standard.verification_status == VerificationStatus.verified
    relevance = semantic * WEIGHT_SEMANTIC + lexical * WEIGHT_LEXICAL
    trust = 1.0 + (TRUST_VERIFIED if verified else 0.0) + (TRUST_FRESHNESS if standard.last_checked_date else 0.0)

    score = min(relevance * trust, 0.99)
    if not verified:
        score = min(score, UNVERIFIED_SCORE_CEILING)

    breakdown = {
        "semantic": round(semantic * WEIGHT_SEMANTIC, 3),
        "lexical": round(lexical * WEIGHT_LEXICAL, 3),
        "relevance": round(relevance, 3),
        "trust_multiplier": round(trust, 2),
    }
    return round(score, 2), breakdown


def find_candidates(db: Session, text: str, limit: int = 5, augment: str = "") -> list[RankedStandard]:
    """Hybrid retrieval: lexical overlap unioned with semantic similarity.

    Semantic recall is what lets 'head protection for site workers' reach a
    record titled 'industrial safety helmets'. When no embedding model is
    available this degrades to the original lexical behaviour rather than
    failing.

    ``augment`` carries what the requirement extractor already worked out -- the
    product, in English. An Indic tender yields no ASCII tokens at all, so
    lexical search finds nothing and cross-script embedding similarity alone can
    fall below the relevance floor. Searching the extracted product alongside the
    original text reuses a translation the system has already made, rather than
    loosening the floor for everyone.
    """
    query = f"{text} {augment}".strip() if augment else text
    terms = extract_terms(query)
    # Short text is its own best summary. A long document is not: embed what it
    # repeats, plus anything the extractor recognised, instead of its opening page.
    semantic_query = query
    if len(query) > LONG_DOCUMENT_CHARS:
        semantic_query = " ".join(terms)
        if augment:
            semantic_query = f"{augment} {semantic_query}"
    query_vector = semantic_index.embed_one(semantic_query) if semantic_index.available else None

    pool: dict[int, Standard] = {item.id: item for item in _lexical_candidates(db, terms)}
    if query_vector is not None:
        # Semantic recall must consider records that share no literal token.
        for standard in db.scalars(select(Standard).where(Standard.embedding.isnot(None))).all():
            pool.setdefault(standard.id, standard)

    ranked: list[RankedStandard] = []
    for standard in pool.values():
        searchable = f"{standard.official_title} {standard.scope_summary}".lower()
        matched = [term for term in terms if term in searchable]
        lexical = min(len(matched) / max(len(terms), 1), 1.0) if terms else 0.0
        semantic = cosine_similarity(query_vector, standard.embedding) if query_vector is not None else 0.0
        score, breakdown = _score(standard, lexical, semantic)
        ranked.append(RankedStandard(
            standard=standard,
            score=score,
            matched_terms=matched,
            lexical_score=round(lexical, 3),
            semantic_score=round(semantic, 3),
            reason=_reason(matched, semantic, query_vector is not None),
            breakdown=breakdown,
        ))

    # Order by evidence tier first, then by score. An illustrative record must
    # never outrank a real standard however well its wording happens to match --
    # an officer reading the list top-down should meet real identifiers first.
    ranked.sort(key=lambda item: (_tier_rank(item.standard), item.score), reverse=True)
    ranked = [item for item in ranked if _is_relevant(item, query, query_vector is not None)]
    return ranked[:limit]


def nearest_records(db: Session, text: str, limit: int = 3) -> list[RankedStandard]:
    """The closest records when nothing clears the relevance floor.

    Deliberately separate from find_candidates. These are not recommendations
    and must never be presented as any: they exist so an officer sees what the
    catalogue does hold rather than an empty screen, and can judge for themselves
    how far off it is. Nothing downstream -- reports, certification, the model
    briefing -- is allowed to read them.
    """
    if not semantic_index.available:
        return []
    query_vector = semantic_index.embed_one(text)
    if query_vector is None:
        return []
    scored: list[RankedStandard] = []
    for standard in db.scalars(select(Standard).where(Standard.embedding.isnot(None))).all():
        similarity = cosine_similarity(query_vector, standard.embedding)
        scored.append(RankedStandard(
            standard=standard,
            score=round(similarity, 2),
            matched_terms=[],
            semantic_score=round(similarity, 3),
            reason="Nearest record in the catalogue. Not a recommendation for this tender.",
        ))
    scored.sort(key=lambda item: item.semantic_score, reverse=True)
    return scored[:limit]


def _tier_rank(standard: Standard) -> int:
    """1 = a real identifier, 0 = illustrative.

    Only demonstration records are demoted. Verified and imported records compete
    on how well they match, because ranking by tier alone put a weakly-matching
    verified helmet standard above a strongly-matching footwear standard purely
    for being verified -- which is worse than useless to an officer buying boots.
    """
    return 1 if standard.standard_number else 0


def _is_relevant(item: RankedStandard, query: str, semantic_ran: bool) -> bool:
    """Keep a candidate only on real evidence, not incidental word overlap."""
    # An explicit IS number in the tender text always retrieves that record.
    if item.standard.standard_number and item.standard.standard_number.lower() in query.lower():
        return True
    # The semantic floor only applies where a vector exists to judge. A record
    # that has not been embedded yet -- newly imported, or seeded while the
    # model was unavailable -- must still be reachable by keyword, otherwise it
    # would be silently invisible to every search.
    if semantic_ran and item.standard.embedding:
        return item.semantic_score >= MIN_SEMANTIC_RELEVANCE
    return bool(item.matched_terms)


def _reason(matched: list[str], semantic: float, semantic_ran: bool) -> str:
    parts: list[str] = []
    if matched:
        shown = ", ".join(matched[:4])
        parts.append(f"Tender wording overlaps this record's title and scope ({shown}).")
    if semantic_ran:
        parts.append(f"Local embedding similarity to the tender text is {semantic:.2f}.")
    if not parts:
        parts.append("Retrieved from the controlled catalogue for officer review.")
    parts.append("Applicability must be confirmed against the official source before use.")
    return " ".join(parts)


def apply_graph_context(db: Session, candidates: list[RankedStandard], limit: int = 4) -> list[RankedStandard]:
    """Annotate and extend the candidate set using one-hop graph traversal.

    Two things happen here. A candidate that text retrieval already found but
    which is also linked to the primary standard gets re-labelled by its edge --
    the relationship is stronger evidence than a weak similarity score. A linked
    standard that retrieval missed entirely is added, because the primary
    standard depends on it regardless of how the tender was worded.
    """
    if not candidates:
        return candidates

    primary = candidates[0].standard
    primary_label = primary.standard_number or primary.official_title
    edges = db.scalars(select(StandardRelationship).where(StandardRelationship.source_id == primary.id)).all()
    if not edges:
        return candidates

    by_standard_id = {item.standard.id: item for item in candidates}
    added = 0

    for edge in edges:
        target = edge.target
        if target is None:
            continue
        label = RELATIONSHIP_TYPES.get(edge.relationship_type, "allied")
        note = f"{edge.relationship_type} of {primary_label}"
        reason = (
            f"Linked in the standards graph as a {label} of {primary_label}. "
            "Included because the primary standard depends on it, not because of tender wording."
        )
        existing = by_standard_id.get(target.id)
        if existing is not None:
            existing.standard_type = label
            existing.relation_note = note
            existing.reason = f"{reason} {existing.reason}"
            existing.breakdown = {**existing.breakdown, "graph_relationship": 1.0}
            continue
        if added >= limit:
            continue
        verified = target.verification_status == VerificationStatus.verified
        # Scale against the primary rather than using a fixed figure. A linked
        # record is only as relevant as the record it hangs off, so a weak
        # primary must not carry confident-looking dependants: a 32% match to a
        # cable standard was showing its linked standard at 62%.
        score = round(min(candidates[0].score * GRAPH_RELATIVE_SCORE, 0.99), 2)
        if not verified:
            score = min(score, UNVERIFIED_SCORE_CEILING)
        candidates.append(RankedStandard(
            standard=target,
            score=score,
            matched_terms=[],
            standard_type=label,
            relation_note=note,
            reason=reason,
            breakdown={"graph_relationship": score},
        ))
        added += 1
    return candidates


def evaluate_qco(db: Session, product_text: str, standard: Standard, on_date: date | None = None) -> dict:
    """Deterministic only: an unverified QCO can never create a mandatory claim."""
    today = on_date or date.today()
    qcos = db.scalars(select(QualityControlOrder).where(QualityControlOrder.mandated_standard_id == standard.id)).all()
    for qco in qcos:
        keyword_match = qco.product_keyword.lower() in product_text.lower()
        enforceable = qco.enforcement_date <= today
        verified = qco.verification_status == VerificationStatus.verified
        lowered = product_text.lower()
        export_exemption = any(term in lowered for term in ("for export", "export order", "manufactured for export"))
        if keyword_match and enforceable and verified and not export_exemption:
            return {"qco_applicable": True, "certification_required": True, "qco": qco}
    return {"qco_applicable": False, "certification_required": False, "qco": None}


def confidence_level(score: float) -> str:
    if score >= 0.8:
        return "high"
    if score >= 0.6:
        return "medium"
    return "low"


def missing_requirements(text: str) -> list[str]:
    checks = {
        "Measurable acceptance or test criteria": ("test", "acceptance", "threshold"),
        "Operating or environmental conditions": ("temperature", "humidity", "environment"),
        "Warranty or service requirement": ("warranty", "service"),
    }
    lowered = text.lower()
    return [label for label, words in checks.items() if not any(word in lowered for word in words)]
