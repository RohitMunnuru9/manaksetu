from contextlib import asynccontextmanager
from threading import Thread
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from io import BytesIO

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from .config import get_settings
from .database import Base, SessionLocal, engine, get_db
from .models import AuditLog, ProductCategory, QualityControlOrder, Recommendation, ReviewDecision, Standard, StandardRelationship, StandardStatus, Tender, TenderRequirement, User, VerificationStatus
from .schemas import AuditDetail, RevokeRequest, StandardDetail, StandardsPage, VerifyRequest, GlancePoint, AnalyticsResponse, DraftResponse, EvidenceSpanRead, ScorecardRead, ScoreRowRead, SectorCount, TopStandard, WatchItem, AmendmentRead, AnalysisResponse, CategoryRead, NearestRecord, AuditRead, BriefingResponse, NetworkEdge, NetworkNode, NetworkResponse, OutdatedCitation, DashboardStats, HealthResponse, LoginRequest, RecommendationRead, ReviewCreate, ReviewRead, StandardRead, TenderCreate, TenderRead, TokenResponse, UserRead
from .security import Permission, create_access_token, get_current_user, permissions_for, require_permission, verify_password
from .seed import seed_demo_data
from .services.summary import document_glance
from .services.traceability import evidence_spans
from .services.scorecard import build_scorecard
from .services.drafting import build_clauses, polish_clauses
from .services.recommendation import apply_graph_context, catalogue_vocabulary, confidence_level, evaluate_qco, find_candidates, missing_requirements, nearest_records, retrieval_mode
from .services.embeddings import semantic_index
from .services.explanation import explain_analysis, warm_model
from .services.versions import describe_currency, outdated_citations
from .bis_import import import_bis_harvest
from .services.documents import DocumentUnreadable, extract_document
from .services.reports import build_docx, build_json, build_pdf, build_xlsx
from .services.requirements import detect_language, extract_requirements

import logging

logger = logging.getLogger(__name__)

settings = get_settings()


def _add_missing_columns() -> None:
    """Tiny dev migration: create_all never alters an existing table, and the
    demo runs on a SQLite file that predates the harvested-catalogue columns."""
    from sqlalchemy import inspect, text as sql_text

    inspector = inspect(engine)
    if "standards" not in inspector.get_table_names():
        return
    present = {column["name"] for column in inspector.get_columns("standards")}
    wanted = {"valid_until": "DATE", "bis_sector": "VARCHAR(200)"}
    with engine.begin() as connection:
        for name, ddl in wanted.items():
            if name not in present:
                connection.execute(sql_text(f"ALTER TABLE standards ADD COLUMN {name} {ddl}"))

    if "tenders" in inspector.get_table_names():
        present = {column["name"] for column in inspector.get_columns("tenders")}
        standard_extra = {
            "verified_by_id": "INTEGER",
            "verified_at": "DATETIME",
            "verification_note": "TEXT",
        }
        present_std = {column["name"] for column in inspector.get_columns("standards")}
        with engine.begin() as connection:
            for name, ddl in standard_extra.items():
                if name not in present_std:
                    connection.execute(sql_text(f"ALTER TABLE standards ADD COLUMN {name} {ddl}"))

        tender_columns = {
            "read_method": "VARCHAR(40)",
            "read_quality": "VARCHAR(20)",
            "read_confidence": "FLOAT",
            "read_notes": "JSON",
        }
        with engine.begin() as connection:
            for name, ddl in tender_columns.items():
                if name not in present:
                    connection.execute(sql_text(f"ALTER TABLE tenders ADD COLUMN {name} {ddl}"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        seed_demo_data(db)
        import_bis_harvest(db)
    # Load the language model off the startup path, so the API is serving
    # immediately and the first analysis does not pay the cold-start cost.
    Thread(target=warm_model, daemon=True).start()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/v1/standards/{standard_id}/revoke", response_model=StandardDetail, tags=["standards"])
def revoke_verification(
    standard_id: int,
    payload: RevokeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.STANDARD_VERIFY)),
) -> StandardDetail:
    """Return a verified record to imported, with the reason recorded.

    The same permission that grants verification can withdraw it. The previous
    verifier's name and note are written into the audit entry before they are
    cleared, so the history of who claimed what is never lost -- only the
    current state of the record changes.
    """
    standard = db.get(Standard, standard_id)
    if not standard:
        raise HTTPException(status_code=404, detail="Standard not found")
    if standard.verification_status != VerificationStatus.verified:
        raise HTTPException(status_code=409, detail="This record is not verified, so there is nothing to revoke.")

    previous = db.get(User, standard.verified_by_id) if standard.verified_by_id else None
    db.add(AuditLog(
        actor_id=user.id,
        action="standard.verification_revoked",
        entity_type="standard",
        entity_id=str(standard.id),
        details={
            "standard_number": standard.standard_number,
            "reason": payload.reason.strip(),
            "previously_verified_by": previous.full_name if previous else "seed data",
            "previous_note": standard.verification_note or "",
        },
    ))
    standard.verification_status = VerificationStatus.pending
    standard.verified_by_id = None
    standard.verified_at = None
    standard.verification_note = None
    db.commit()
    db.refresh(standard)
    return standard_detail(standard.id, db, user)


# Pydantic's own errors are written for developers: "String should have at most
# 50000 characters", wrapped in a loc array and a type field. An officer sees
# whatever the API returns, so it is turned into a sentence about the field
# they actually filled in.
_FIELD_NAMES = {
    "title": "the short title",
    "description": "the description",
    "note": "the note",
    "language": "the language",
    "file": "the file",
}


def _readable(error: dict) -> str:
    field = next((str(part) for part in reversed(error.get("loc", [])) if part not in {"body", "query", "path"}), "")
    name = _FIELD_NAMES.get(field, field.replace("_", " ") or "one of the fields")
    kind = error.get("type", "")
    context = error.get("ctx", {}) or {}

    if kind == "missing":
        return f"Please fill in {name}."
    if kind == "string_too_short":
        least = context.get("min_length")
        return f"Please write a little more in {name}" + (f" — at least {least} characters." if least else ".")
    if kind == "string_too_long":
        most = context.get("max_length")
        return (
            f"{name.capitalize()} is too long"
            + (f" — the limit is {most:,} characters. Upload the document instead." if most else ".")
        )
    if kind.startswith("string_pattern"):
        return f"{name.capitalize()} is not in a form this accepts."
    return f"{name.capitalize()} is not valid."


@app.exception_handler(RequestValidationError)
async def readable_validation_error(_: Request, exc: RequestValidationError):
    errors = exc.errors() or []
    return JSONResponse(
        status_code=422,
        content={
            "detail": " ".join(_readable(error) for error in errors[:3]) or "That request could not be accepted.",
            # The original stays available for anyone debugging against the API.
            "errors": [{"field": ".".join(str(part) for part in e.get("loc", [])), "type": e.get("type")} for e in errors],
        },
    )


@app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
def health(db: Session = Depends(get_db)) -> HealthResponse:
    db.execute(text("SELECT 1"))
    return HealthResponse(status="healthy", service=settings.app_name, database="connected")


@app.post("/api/v1/auth/login", response_model=TokenResponse, tags=["auth"])
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    return issue_token(payload.email, payload.password, db)


def issue_token(email: str, password: str, db: Session) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == email.lower()))
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    db.add(AuditLog(actor_id=user.id, action="user.login", entity_type="user", entity_id=str(user.id)))
    db.commit()
    return TokenResponse(access_token=create_access_token(str(user.id)))


@app.post("/api/v1/auth/token", response_model=TokenResponse, tags=["auth"])
def oauth2_token(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> TokenResponse:
    return issue_token(form.username, form.password, db)


@app.get("/api/v1/auth/me", response_model=UserRead, tags=["auth"])
def current_user_profile(user: User = Depends(get_current_user)) -> UserRead:
    return UserRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        permissions=sorted(permissions_for(user.role)),
    )


# Browsing a 2,914-record catalogue needs paging and filters. Returning the
# first fifty of everything, as this did, showed under two percent of it.
MAX_PAGE_SIZE = 100


@app.get("/api/v1/standards", response_model=StandardsPage, tags=["standards"])
def list_standards(
    q: str | None = None,
    tier: str | None = None,
    sector: str | None = None,
    page: int = 1,
    page_size: int = 25,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission(Permission.TENDER_READ)),
) -> StandardsPage:
    page = max(1, page)
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))

    query = select(Standard)
    if q:
        term = f"%{q.strip()}%"
        # Officers search by number as readily as by name.
        query = query.where(
            or_(
                Standard.official_title.ilike(term),
                Standard.standard_number.ilike(term),
                Standard.scope_summary.ilike(term),
            )
        )
    if tier in {"verified", "pending", "demo"}:
        query = query.where(Standard.verification_status == VerificationStatus(tier))
    if sector:
        query = query.where(Standard.bis_sector == sector)

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(Standard.standard_number.is_(None), Standard.standard_number)
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    tier_counts = {
        status.value: count
        for status, count in db.execute(
            select(Standard.verification_status, func.count(Standard.id)).group_by(Standard.verification_status)
        ).all()
    }
    sectors = [
        name
        for (name,) in db.execute(
            select(Standard.bis_sector)
            .where(Standard.bis_sector.isnot(None))
            .group_by(Standard.bis_sector)
            .order_by(func.count(Standard.id).desc())
            .limit(60)
        ).all()
    ]

    return StandardsPage(
        items=[StandardRead.model_validate(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
        pages=max(1, (total + page_size - 1) // page_size),
        tier_counts=tier_counts,
        sectors=sectors,
    )


@app.get("/api/v1/standards/{standard_id}", response_model=StandardDetail, tags=["standards"])
def standard_detail(
    standard_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission(Permission.TENDER_READ)),
) -> StandardDetail:
    """Everything known about one record, so an officer can decide whether it
    may be cited without leaving the page."""
    standard = db.get(Standard, standard_id)
    if not standard:
        raise HTTPException(status_code=404, detail="Standard not found")

    verifier = db.get(User, standard.verified_by_id) if standard.verified_by_id else None
    linked = db.scalar(
        select(func.count(StandardRelationship.id)).where(
            or_(
                StandardRelationship.source_id == standard.id,
                StandardRelationship.target_id == standard.id,
            )
        )
    ) or 0
    orders = [
        title
        for (title,) in db.execute(
            select(QualityControlOrder.title).where(QualityControlOrder.mandated_standard_id == standard.id)
        ).all()
    ]
    used = db.scalar(
        select(func.count(Recommendation.id)).where(Recommendation.standard_id == standard.id)
    ) or 0

    return StandardDetail(
        **{
            field: getattr(standard, field)
            for field in (
                "id", "standard_number", "catalogue_ref", "official_title", "scope_summary",
                "publication_year", "status", "official_source_url", "source_organisation",
                "retrieved_date", "last_checked_date", "valid_until", "bis_sector",
                "verification_status", "verified_at", "verification_note",
            )
        },
        verified_by=verifier.full_name if verifier else None,
        category=standard.category.name if standard.category else None,
        superseded_by=(
            standard.superseded_by.standard_number or standard.superseded_by.catalogue_ref
            if standard.superseded_by
            else None
        ),
        amendments=[
            AmendmentRead(
                amendment_number=a.amendment_number,
                issued_date=a.issued_date.isoformat() if a.issued_date else None,
                summary=a.summary,
                official_source_url=a.official_source_url,
            )
            for a in standard.amendments
        ],
        linked_standards=linked,
        certification_orders=orders,
        used_in_tenders=used,
    )


@app.post("/api/v1/standards/{standard_id}/verify", response_model=StandardDetail, tags=["standards"])
def verify_standard(
    standard_id: int,
    payload: VerifyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_permission(Permission.STANDARD_VERIFY)),
) -> StandardDetail:
    """Promote an imported record to verified.

    This is the human step the whole three-tier evidence model rests on, and
    until now it existed only as a claim. A record moves to verified when a
    person says they have checked it against the official BIS entry, and their
    name and note are stored with it -- a tier nobody is accountable for is not
    evidence.

    Demonstration records can never be promoted: they carry no identifier, so
    there is nothing to have checked.
    """
    standard = db.get(Standard, standard_id)
    if not standard:
        raise HTTPException(status_code=404, detail="Standard not found")
    if not standard.standard_number:
        raise HTTPException(
            status_code=422,
            detail="This record has no standard number, so there is nothing to verify against an official source.",
        )
    if not payload.confirmed_against_source:
        raise HTTPException(
            status_code=422,
            detail="A record is only verified once it has been checked against the official BIS entry.",
        )
    if standard.verification_status == VerificationStatus.verified:
        raise HTTPException(status_code=409, detail="This record is already verified.")

    standard.verification_status = VerificationStatus.verified
    standard.verified_by_id = user.id
    standard.verified_at = datetime.now(timezone.utc)
    standard.verification_note = payload.note.strip() or None
    standard.last_checked_date = datetime.now(timezone.utc).date()

    db.add(AuditLog(
        actor_id=user.id,
        action="standard.verified",
        entity_type="standard",
        entity_id=str(standard.id),
        details={"standard_number": standard.standard_number, "note": standard.verification_note or ""},
    ))
    db.commit()
    db.refresh(standard)
    return standard_detail(standard.id, db, user)


# How a relationship type presents in the network view.
_EDGE_WORDS = {
    "tested_by": ("Tested by", "test"),
    "safety": ("Safety rules", "safety"),
    "terminology": ("Definitions", "terminology"),
    "references": ("References", "standard"),
    "installation": ("Installation", "safety"),
}


def _tier_of(standard: Standard) -> str:
    if standard.verification_status == VerificationStatus.verified and standard.standard_number:
        return "verified"
    return "checking" if standard.standard_number else "example"


def _node(standard: Standard, kind: str, centre: bool = False) -> NetworkNode:
    return NetworkNode(
        id=f"s{standard.id}",
        label=standard.official_title,
        identifier=standard.standard_number or standard.catalogue_ref,
        kind=kind,
        tier=_tier_of(standard),
        is_centre=centre,
    )


@app.get("/api/v1/standards/{standard_id}/network", response_model=NetworkResponse, tags=["standards"])
def standard_network(standard_id: int, db: Session = Depends(get_db), _: User = Depends(require_permission(Permission.TENDER_READ))) -> NetworkResponse:
    """Everything connected to one standard, ready to draw.

    Built from the same relationship edges retrieval uses, so the picture cannot
    drift from the recommendations: if an edge is not in the database, it is not
    on the diagram.
    """
    centre = db.get(Standard, standard_id)
    if not centre:
        raise HTTPException(status_code=404, detail="Standard not found")

    nodes: dict[str, NetworkNode] = {}
    edges: list[NetworkEdge] = []
    nodes[f"s{centre.id}"] = _node(centre, "standard", centre=True)

    outgoing = db.scalars(select(StandardRelationship).where(StandardRelationship.source_id == centre.id)).all()
    for edge in outgoing:
        target = edge.target
        if target is None:
            continue
        word, kind = _EDGE_WORDS.get(edge.relationship_type, ("Linked", "standard"))
        nodes.setdefault(f"s{target.id}", _node(target, kind))
        edges.append(NetworkEdge(source=f"s{centre.id}", target=f"s{target.id}", label=word))

    incoming = db.scalars(select(StandardRelationship).where(StandardRelationship.target_id == centre.id)).all()
    for edge in incoming:
        source = edge.source
        if source is None:
            continue
        nodes.setdefault(f"s{source.id}", _node(source, "standard"))
        edges.append(NetworkEdge(source=f"s{source.id}", target=f"s{centre.id}", label="References"))

    # The record that replaced this one, or the one this replaced.
    if centre.superseded_by is not None:
        nodes.setdefault(f"s{centre.superseded_by.id}", _node(centre.superseded_by, "revision"))
        edges.append(NetworkEdge(source=f"s{centre.id}", target=f"s{centre.superseded_by.id}", label="Replaced by"))
    replaced = db.scalars(select(Standard).where(Standard.superseded_by_id == centre.id)).all()
    for old in replaced:
        nodes.setdefault(f"s{old.id}", _node(old, "revision"))
        edges.append(NetworkEdge(source=f"s{old.id}", target=f"s{centre.id}", label="Replaced by", dashed=True))

    # A quality control order only appears when it actually names this standard.
    for qco in db.scalars(select(QualityControlOrder).where(QualityControlOrder.mandated_standard_id == centre.id)).all():
        key = f"q{qco.id}"
        nodes[key] = NetworkNode(
            id=key, label=qco.title, identifier="Quality Control Order",
            kind="regulatory",
            tier="verified" if qco.verification_status == VerificationStatus.verified else "checking",
        )
        edges.append(NetworkEdge(source=key, target=f"s{centre.id}", label="Governs"))

    return NetworkResponse(
        centre_id=f"s{centre.id}",
        nodes=list(nodes.values()),
        edges=edges,
        linked_standards=len([n for n in nodes.values() if n.id.startswith("s") and not n.is_centre]),
        official_source_verified=bool(centre.official_source_url) and centre.verification_status == VerificationStatus.verified,
        current_version_confirmed=centre.status == StandardStatus.current,
    )


@app.get("/api/v1/categories", response_model=list[CategoryRead], tags=["standards"])
def list_categories(db: Session = Depends(get_db), _: User = Depends(require_permission(Permission.TENDER_READ))) -> list[CategoryRead]:
    """What the catalogue actually covers.

    Shown when a search returns nothing, so the officer learns the scope of the
    catalogue instead of being told only that their tender failed.
    """
    rows = []
    for category in db.scalars(select(ProductCategory).order_by(ProductCategory.name)).all():
        records = db.scalars(select(Standard).where(Standard.category_id == category.id)).all()
        if not records:
            continue
        rows.append(CategoryRead(
            name=category.name,
            description=category.description or "",
            record_count=len(records),
            verified_count=sum(1 for r in records if r.verification_status == VerificationStatus.verified),
        ))
    return rows


@app.get("/api/v1/dashboard", response_model=DashboardStats, tags=["system"])
def dashboard(db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> DashboardStats:
    return DashboardStats(
        total_tenders=db.scalar(select(func.count(Tender.id))) or 0,
        pending_reviews=db.scalar(select(func.count(Tender.id)).where(Tender.status == "review_required")) or 0,
        verified_standards=db.scalar(select(func.count(Standard.id)).where(Standard.verification_status == VerificationStatus.verified)) or 0,
        total_standards=db.scalar(select(func.count(Standard.id))) or 0,
        completed_reviews=db.scalar(select(func.count(ReviewDecision.id)).where(ReviewDecision.decision == "approved")) or 0,
    )


@app.get("/api/v1/tenders", response_model=list[TenderRead], tags=["tenders"])
def list_tenders(db: Session = Depends(get_db), _: User = Depends(require_permission(Permission.TENDER_READ))) -> list[Tender]:
    return list(db.scalars(select(Tender).order_by(Tender.created_at.desc()).limit(100)).all())


def _tier_warning(standard: Standard) -> str:
    """What the officer must know before citing a record that is not verified."""
    if standard.verification_status == VerificationStatus.pending and standard.standard_number:
        return (
            "Imported from an official BIS page but not yet confirmed by an officer. "
            "Check the title and year against the official source before citing it."
        )
    return "Demonstration record with no standard number. Do not cite in a tender."


def _currency_fields(standard: Standard) -> dict:
    """Version facts shaped for RecommendationRead."""
    currency = describe_currency(standard)
    return {
        "is_outdated": currency["is_outdated"],
        "superseded_by": currency["superseded_by"],
        "amendments": [AmendmentRead(**item) for item in currency["amendments"]],
        "currency_warning": currency["currency_warning"],
    }


def run_analysis(db: Session, tender: Tender, actor_id: int | None = None) -> AnalysisResponse:
    tender.language = detect_language(tender.source_text)
    extracted = extract_requirements(tender.source_text, catalogue_vocabulary(db))
    for item in extracted:
        db.add(TenderRequirement(
            tender_id=tender.id,
            requirement_type=item.requirement_type,
            value=item.value,
            confidence=item.confidence,
            source_excerpt=item.source_excerpt,
            needs_confirmation=item.needs_confirmation,
        ))
    # Feed the extracted product back into the search, but only where the term was
    # actually found in the tender rather than inferred from meaning. An inferred
    # product is already a guess; using it to widen the search compounds the
    # guess -- "water pumps for irrigation" was inferred as "drinking water" and
    # that inference then pulled up the packaged-water standard. A literal match
    # carries no such doubt, which is what makes an Indic tender work: the Telugu
    # term for helmet is in the term list and matches outright.
    augment = " ".join(
        item.value for item in extracted
        if item.requirement_type in {"product", "intended_use"} and not item.needs_confirmation
    )
    candidates = find_candidates(db, tender.source_text, augment=augment)
    if candidates:
        # Highest-ranked retrieval hit is the primary; the rest matched on text
        # alone, so they are allied candidates rather than primary standards.
        for position, candidate in enumerate(candidates):
            candidate.standard_type = "primary" if position == 0 else "allied"
        # Graph traversal then re-labels anything linked to the primary and adds
        # normative references or test methods that retrieval missed.
        candidates = apply_graph_context(db, candidates)
        # Graph-derived records are appended, so without this a 29% linked record
        # sits below a 25% retrieval hit. The primary stays first; the rest read
        # in the order their confidence suggests.
        candidates = candidates[:1] + sorted(candidates[1:], key=lambda c: c.score, reverse=True)

    response_items: list[RecommendationRead] = []
    for candidate in candidates:
        standard = candidate.standard
        qco = evaluate_qco(db, tender.source_text, standard)
        verified = standard.verification_status == VerificationStatus.verified and bool(standard.standard_number and standard.official_source_url)
        warning = None if verified else _tier_warning(standard)
        score = candidate.score if verified else min(candidate.score, 0.69)
        recommendation = Recommendation(
            tender_id=tender.id,
            standard_id=standard.id,
            standard_type=candidate.standard_type,
            reason=candidate.reason,
            matched_requirements=candidate.matched_terms,
            confidence_score=score,
            human_review_required=True,
            score_breakdown=candidate.breakdown,
            relation_note=candidate.relation_note,
        )
        db.add(recommendation)
        response_items.append(RecommendationRead(
            standard=StandardRead.model_validate(standard),
            standard_type=recommendation.standard_type,
            reason_for_recommendation=recommendation.reason,
            matched_requirements=candidate.matched_terms,
            confidence_score=score,
            confidence_level=confidence_level(score),
            certification_required=qco["certification_required"],
            qco_applicable=qco["qco_applicable"],
            qco_title=qco["qco"].title if qco["qco"] else None,
            qco_enforcement_date=qco["qco"].enforcement_date if qco["qco"] else None,
            qco_source_url=qco["qco"].official_source_url if qco["qco"] else None,
            human_review_required=True,
            warning=warning,
            relation_note=candidate.relation_note,
            score_breakdown=candidate.breakdown,
            evidence_spans=[
                EvidenceSpanRead(text=span.text, start=span.start, end=span.end, terms=span.terms)
                for span in evidence_spans(tender.source_text, candidate.matched_terms)
            ],
            **_currency_fields(standard),
        ))
    tender.status = "review_required"
    db.add(AuditLog(actor_id=actor_id, action="tender.analysis.completed", entity_type="tender", entity_id=str(tender.id), details={"candidate_count": len(response_items), "retrieval_mode": retrieval_mode()}))
    db.commit()
    guardrail = None if response_items else "No verified recommendation found. Expert review is required."
    # Only when nothing matched: show what the catalogue is nearest to, so the
    # officer sees its scope rather than a blank screen. Never recommendations.
    nearest = [] if response_items else [
        NearestRecord(standard=StandardRead.model_validate(item.standard), similarity=item.semantic_score)
        for item in nearest_records(db, tender.source_text)
    ]
    gaps = missing_requirements(tender.source_text)
    outdated = outdated_citations(db, tender.source_text)
    # The prose briefing is deliberately NOT generated here. Local generation
    # takes tens of seconds, and an officer should see evidence immediately
    # rather than wait on a description of it. The dashboard requests the
    # briefing separately once results are on screen.
    return AnalysisResponse(
        tender=TenderRead.model_validate(tender),
        recommendations=response_items,
        extracted_requirements=extracted,
        missing_requirements=gaps,
        outdated_citations=[OutdatedCitation(**item) for item in outdated],
        guardrail_message=guardrail,
        nearest_records=nearest,
        retrieval_mode=retrieval_mode(),
        embedding_model=semantic_index.model_name,
        scorecard=_scorecard_read(tender.source_text, extracted),
        officer_glance=_glance_points(tender, extracted, response_items, gaps, outdated),
        officer_summary_status="pending" if settings.enable_llm_explanations else "disabled",
    )


def _glance_points(tender, requirements: list, recommendations: list, missing: list[str], outdated: list) -> list[GlancePoint]:
    return [
        GlancePoint(label=point.label, value=point.value, tone=point.tone)
        for point in document_glance(
            language=tender.language,
            filename=tender.filename,
            text_length=len(tender.source_text or ""),
            requirements=requirements,
            recommendations=recommendations,
            missing=missing,
            outdated_count=len(outdated),
        )
    ]


def _scorecard_read(text: str, requirements: list) -> ScorecardRead:
    card = build_scorecard(text, requirements)
    return ScorecardRead(
        score=card.score,
        grade=card.grade,
        rows=[ScoreRowRead(key=r.key, label=r.label, weight=r.weight, satisfied=r.satisfied, evidence=r.evidence, fix=r.fix) for r in card.rows],
        fixes=card.fixes,
    )


def saved_analysis(db: Session, tender: Tender) -> AnalysisResponse:
    items = db.scalars(select(Recommendation).where(Recommendation.tender_id == tender.id).order_by(Recommendation.confidence_score.desc())).all()
    recommendations = []
    for item in items:
        qco = evaluate_qco(db, tender.source_text, item.standard)
        verified = item.standard.verification_status == VerificationStatus.verified and bool(item.standard.standard_number and item.standard.official_source_url)
        recommendations.append(RecommendationRead(
            standard=StandardRead.model_validate(item.standard),
            standard_type=item.standard_type,
            reason_for_recommendation=item.reason,
            matched_requirements=item.matched_requirements,
            confidence_score=item.confidence_score,
            confidence_level=confidence_level(item.confidence_score),
            certification_required=qco["certification_required"],
            qco_applicable=qco["qco_applicable"],
            qco_title=qco["qco"].title if qco["qco"] else None,
            qco_enforcement_date=qco["qco"].enforcement_date if qco["qco"] else None,
            qco_source_url=qco["qco"].official_source_url if qco["qco"] else None,
            human_review_required=item.human_review_required,
            warning=None if verified else _tier_warning(item.standard),
            relation_note=item.relation_note,
            score_breakdown=item.score_breakdown or {},
            evidence_spans=[
                EvidenceSpanRead(text=span.text, start=span.start, end=span.end, terms=span.terms)
                for span in evidence_spans(tender.source_text, item.matched_requirements or [])
            ],
            **_currency_fields(item.standard),
        ))
    guardrail = None if recommendations else "No verified recommendation found. Expert review is required."
    extracted = list(db.scalars(select(TenderRequirement).where(TenderRequirement.tender_id == tender.id)).all())
    saved_gaps = missing_requirements(tender.source_text)
    saved_outdated = outdated_citations(db, tender.source_text)
    return AnalysisResponse(
        tender=TenderRead.model_validate(tender),
        recommendations=recommendations,
        extracted_requirements=extracted,
        missing_requirements=saved_gaps,
        outdated_citations=[OutdatedCitation(**item) for item in saved_outdated],
        guardrail_message=guardrail,
        retrieval_mode=retrieval_mode(),
        embedding_model=semantic_index.model_name,
        scorecard=_scorecard_read(tender.source_text, extracted),
        officer_glance=_glance_points(tender, extracted, recommendations, saved_gaps, saved_outdated),
        # Marked pending, not generated, so that reopening a saved analysis
        # requests the briefing the same way a fresh one does.
        officer_summary_status="pending" if (settings.enable_llm_explanations and recommendations) else "disabled",
    )


@app.post("/api/v1/tenders/analyse", response_model=AnalysisResponse, tags=["tenders"])
def analyse_text(payload: TenderCreate, db: Session = Depends(get_db), user: User = Depends(require_permission(Permission.TENDER_CREATE))) -> AnalysisResponse:
    tender = Tender(reference=f"MS-{datetime.now(timezone.utc):%Y}-{uuid4().hex[:6].upper()}", title=payload.title, source_text=payload.description, language=payload.language, created_by_id=user.id)
    db.add(tender)
    db.flush()
    return run_analysis(db, tender, user.id)


@app.get("/api/v1/tenders/{tender_id}", response_model=AnalysisResponse, tags=["tenders"])
def get_tender_analysis(tender_id: int, db: Session = Depends(get_db), _: User = Depends(require_permission(Permission.TENDER_READ))) -> AnalysisResponse:
    tender = db.get(Tender, tender_id)
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    return saved_analysis(db, tender)


ALLOWED_UPLOADS = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "image/png",
    "image/jpeg",
}


async def save_upload(file: UploadFile) -> tuple[Path, str]:
    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_UPLOADS:
        raise HTTPException(status_code=415, detail="Only PDF, DOCX, XLSX, TXT, PNG, and JPEG files are accepted")
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb} MB")
    safe_name = f"{uuid4().hex}_{Path(file.filename or 'tender').name}"
    destination = settings.upload_dir / safe_name
    destination.write_bytes(content)
    return destination, content_type


@app.post("/api/v1/tenders/upload", response_model=TenderRead, tags=["tenders"])
async def upload_tender(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_permission(Permission.TENDER_CREATE))) -> Tender:
    destination, _ = await save_upload(file)
    tender = Tender(reference=f"MS-{datetime.now(timezone.utc):%Y}-{uuid4().hex[:6].upper()}", title=Path(file.filename or "Untitled tender").stem, filename=destination.name, status="uploaded", created_by_id=user.id)
    db.add(tender)
    db.commit()
    db.refresh(tender)
    return tender


@app.post("/api/v1/tenders/upload/analyse", response_model=AnalysisResponse, tags=["tenders"])
async def upload_and_analyse(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_permission(Permission.TENDER_CREATE))) -> AnalysisResponse:
    destination, content_type = await save_upload(file)
    try:
        extraction = extract_document(destination, content_type)
    except DocumentUnreadable as exc:
        # These carry a sentence written for the officer; pass it through
        # unchanged rather than wrapping it in machine wording.
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - anything unforeseen
        destination.unlink(missing_ok=True)
        logger.exception("Unexpected failure reading %s", file.filename)
        raise HTTPException(
            status_code=422,
            detail="This file could not be read. If it is a scan or a photograph, make sure the page is flat and in focus.",
        ) from exc
    tender = Tender(
        reference=f"MS-{datetime.now(timezone.utc):%Y}-{uuid4().hex[:6].upper()}",
        title=Path(file.filename or "Untitled tender").stem,
        filename=destination.name,
        source_text=extraction.text,
        status="ocr_required" if extraction.requires_ocr else "extracted",
        created_by_id=user.id,
        read_method=extraction.method,
        read_quality=extraction.quality,
        read_confidence=extraction.ocr_confidence,
        read_notes=extraction.notes or [],
    )
    if not extraction.text.strip():
        # Nothing legible came back, so there is nothing to search on. Say so
        # rather than running retrieval over an empty string and presenting
        # whatever the catalogue happens to be nearest to.
        destination.unlink(missing_ok=True)
        raise HTTPException(
            status_code=422,
            detail=(
                "No readable text could be taken from this document. "
                + (extraction.notes[0] if extraction.notes else "")
            ).strip(),
        )
    db.add(tender)
    db.flush()
    db.add(AuditLog(actor_id=user.id, action="document.extracted", entity_type="tender", entity_id=str(tender.id), details={"method": extraction.method, "page_count": extraction.page_count, "tables_found": extraction.tables_found, "requires_ocr": extraction.requires_ocr}))
    if extraction.requires_ocr:
        db.commit()
        return AnalysisResponse(tender=TenderRead.model_validate(tender), recommendations=[], missing_requirements=[], guardrail_message="Scanned document detected. Local OCR processing is required before recommendations can be generated.")
    return run_analysis(db, tender, user.id)


@app.get("/api/v1/tenders/{tender_id}/briefing", response_model=BriefingResponse, tags=["tenders"])
def tender_briefing(tender_id: int, db: Session = Depends(get_db), _: User = Depends(require_permission(Permission.TENDER_READ))) -> BriefingResponse:
    """Generate the prose briefing for an analysis that already exists.

    Separate from the analysis itself so that slow, unavailable or rejected
    generation can never delay or fail the evidence the officer actually needs.
    """
    tender = db.get(Tender, tender_id)
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    analysis = saved_analysis(db, tender)
    summary = explain_analysis(
        tender.source_text,
        analysis.recommendations,
        analysis.missing_requirements,
        requirements=analysis.extracted_requirements,
        language=tender.language,
        filename=tender.filename,
    )
    return BriefingResponse(
        officer_summary=summary.text,
        officer_summary_status=summary.status,
        officer_summary_model=summary.model,
    )


@app.post("/api/v1/tenders/{tender_id}/draft", response_model=DraftResponse, tags=["tenders"])
def draft_specification(tender_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission(Permission.TENDER_CREATE))) -> DraftResponse:
    """Draft tender clauses from the saved analysis.

    The deterministic template is the text of record: it cites only retrieved
    records that carry a real standard number. The local model may rewrite it
    for fluency, but the rewrite is discarded the moment it mentions an
    identifier retrieval did not supply -- same guarantee as the briefing.
    """
    tender = db.get(Tender, tender_id)
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    analysis = saved_analysis(db, tender)
    requirements = {item.requirement_type: item.value for item in analysis.extracted_requirements}
    draft = build_clauses(
        analysis.recommendations,
        product=requirements.get("product"),
        quantity=requirements.get("quantity"),
    )
    certification = any(item.certification_required for item in analysis.recommendations)
    draft = polish_clauses(draft, certification)
    db.add(AuditLog(actor_id=user.id, action="tender.draft.generated", entity_type="tender", entity_id=str(tender.id), details={"source": draft.source, "identifiers": draft.identifiers_used}))
    db.commit()
    return DraftResponse(clauses=draft.clauses, source=draft.source, identifiers_used=draft.identifiers_used, note=draft.note)


@app.get("/api/v1/analytics/overview", response_model=AnalyticsResponse, tags=["analytics"])
def analytics_overview(db: Session = Depends(get_db), _: User = Depends(require_permission(Permission.TENDER_READ))) -> AnalyticsResponse:
    """Aggregates across every analysis, plus the currency watchlist.

    The watchlist is the amendment-watch feature: every standard that a saved
    recommendation actually relies on is checked against what the catalogue
    knows about its currency -- supersession, non-current status, or an official
    validity date inside the next 180 days. Deterministic, like everything else
    that carries a legal implication.
    """
    from datetime import date, timedelta

    total_tenders = db.scalar(select(func.count(Tender.id))) or 0
    tier_counts = dict(
        db.execute(select(Standard.verification_status, func.count(Standard.id)).group_by(Standard.verification_status)).all()
    )
    languages = dict(db.execute(select(Tender.language, func.count(Tender.id)).group_by(Tender.language)).all())

    top_rows = db.execute(
        select(Standard.id, Standard.standard_number, Standard.catalogue_ref, Standard.official_title, func.count(Recommendation.id).label("uses"))
        .join(Recommendation, Recommendation.standard_id == Standard.id)
        .group_by(Standard.id)
        .order_by(func.count(Recommendation.id).desc())
        .limit(8)
    ).all()
    top = [
        TopStandard(identifier=number or ref or "internal", title=title, count=uses)
        for _sid, number, ref, title, uses in top_rows
    ]

    sector_rows = db.execute(
        select(Standard.bis_sector, func.count(Standard.id))
        .where(Standard.bis_sector.isnot(None))
        .group_by(Standard.bis_sector)
        .order_by(func.count(Standard.id).desc())
        .limit(10)
    ).all()

    horizon = date.today() + timedelta(days=180)
    expiring = db.scalar(
        select(func.count(Standard.id)).where(Standard.valid_until.isnot(None), Standard.valid_until <= horizon)
    ) or 0

    # Currency watch over standards a recommendation actually relies on.
    relied = db.scalars(
        select(Standard)
        .join(Recommendation, Recommendation.standard_id == Standard.id)
        .where(Standard.standard_number.isnot(None))
        .distinct()
    ).all()
    watch: list[WatchItem] = []
    for standard in relied:
        if standard.superseded_by_id and standard.superseded_by is not None:
            replacement = standard.superseded_by.standard_number or standard.superseded_by.catalogue_ref or "a newer record"
            watch.append(WatchItem(standard_id=standard.id, identifier=standard.standard_number, title=standard.official_title,
                                   issue="superseded", detail=f"Replaced by {replacement}. Tenders citing it need updating."))
        elif standard.status not in (StandardStatus.current,):
            watch.append(WatchItem(standard_id=standard.id, identifier=standard.standard_number, title=standard.official_title,
                                   issue=standard.status.value, detail="Not confirmed current. Verify the edition before contract award."))
        elif standard.valid_until is not None and standard.valid_until <= horizon:
            watch.append(WatchItem(standard_id=standard.id, identifier=standard.standard_number, title=standard.official_title,
                                   issue="review due", detail=f"Official validity runs to {standard.valid_until.isoformat()}. Recheck before then."))

    return AnalyticsResponse(
        total_tenders=total_tenders,
        total_standards=sum(tier_counts.values()),
        verified_standards=tier_counts.get(VerificationStatus.verified, 0),
        pending_standards=tier_counts.get(VerificationStatus.pending, 0),
        demo_records=tier_counts.get(VerificationStatus.demo, 0),
        tenders_by_language=languages,
        top_standards=top,
        top_sectors=[SectorCount(name=name, count=count) for name, count in sector_rows],
        watch=watch[:20],
        expiring_within_180_days=expiring,
    )


@app.post("/api/v1/tenders/{tender_id}/review", response_model=ReviewRead, tags=["reviews"])
def review_tender(tender_id: int, payload: ReviewCreate, db: Session = Depends(get_db), user: User = Depends(require_permission(Permission.REVIEW_SUBMIT))) -> ReviewDecision:
    tender = db.get(Tender, tender_id)
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    decision = ReviewDecision(tender_id=tender.id, reviewer_id=user.id, decision=payload.decision, note=payload.note)
    tender.status = "approved" if payload.decision == "approved" else payload.decision
    db.add(decision)
    db.flush()
    db.add(AuditLog(actor_id=user.id, action=f"tender.review.{payload.decision}", entity_type="tender", entity_id=str(tender.id), details={"review_id": decision.id, "note": payload.note}))
    db.commit()
    db.refresh(decision)
    return decision


@app.get("/api/v1/audit", response_model=list[AuditDetail], tags=["audit"])
def audit_history(
    action: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    _: User = Depends(require_permission(Permission.AUDIT_READ)),
) -> list[AuditDetail]:
    """The trail, with the actor resolved.

    It recorded who did what from the beginning; the API returned only what,
    which makes an audit log that cannot answer the question it exists for.
    """
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    rows = list(db.scalars(query.limit(max(1, min(limit, 500)))).all())

    actor_ids = {row.actor_id for row in rows if row.actor_id}
    actors = {
        user.id: user
        for user in db.scalars(select(User).where(User.id.in_(actor_ids))).all()
    } if actor_ids else {}

    return [
        AuditDetail(
            id=row.id,
            action=row.action,
            entity_type=row.entity_type,
            entity_id=row.entity_id,
            details=row.details or {},
            created_at=row.created_at,
            actor_name=actors[row.actor_id].full_name if row.actor_id in actors else None,
            actor_email=actors[row.actor_id].email if row.actor_id in actors else None,
            actor_role=actors[row.actor_id].role if row.actor_id in actors else None,
        )
        for row in rows
    ]


@app.get("/api/v1/tenders/{tender_id}/report/{report_format}", tags=["reports"])
def download_report(tender_id: int, report_format: str, db: Session = Depends(get_db), user: User = Depends(require_permission(Permission.REPORT_EXPORT))) -> StreamingResponse:
    tender = db.get(Tender, tender_id)
    if not tender:
        raise HTTPException(status_code=404, detail="Tender not found")
    recommendations = list(db.scalars(select(Recommendation).where(Recommendation.tender_id == tender.id)).all())
    builders = {
        "json": (build_json, "application/json"),
        "pdf": (build_pdf, "application/pdf"),
        "docx": (build_docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "xlsx": (build_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    }
    if report_format not in builders:
        raise HTTPException(status_code=400, detail="Report format must be json, pdf, docx, or xlsx")
    builder, media_type = builders[report_format]
    payload = builder(tender, recommendations)
    db.add(AuditLog(actor_id=user.id, action="report.generated", entity_type="tender", entity_id=str(tender.id), details={"format": report_format}))
    db.commit()
    headers = {"Content-Disposition": f'attachment; filename="{tender.reference}.{report_format}"'}
    return StreamingResponse(BytesIO(payload), media_type=media_type, headers=headers)
