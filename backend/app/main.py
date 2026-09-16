from contextlib import asynccontextmanager
from threading import Thread
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from io import BytesIO

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from .config import get_settings
from .database import Base, SessionLocal, engine, get_db
from .models import AuditLog, Recommendation, ReviewDecision, Standard, Tender, TenderRequirement, User, VerificationStatus
from .schemas import AmendmentRead, AnalysisResponse, AuditRead, BriefingResponse, OutdatedCitation, DashboardStats, HealthResponse, LoginRequest, RecommendationRead, ReviewCreate, ReviewRead, StandardRead, TenderCreate, TenderRead, TokenResponse, UserRead
from .security import Permission, create_access_token, get_current_user, permissions_for, require_permission, verify_password
from .seed import seed_demo_data
from .services.recommendation import apply_graph_context, confidence_level, evaluate_qco, find_candidates, missing_requirements, retrieval_mode
from .services.embeddings import semantic_index
from .services.explanation import explain_analysis, warm_model
from .services.versions import describe_currency, outdated_citations
from .services.documents import extract_document
from .services.reports import build_docx, build_json, build_pdf, build_xlsx
from .services.requirements import detect_language, extract_requirements

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        seed_demo_data(db)
    # Load the language model off the startup path, so the API is serving
    # immediately and the first analysis does not pay the cold-start cost.
    Thread(target=warm_model, daemon=True).start()
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


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


@app.get("/api/v1/standards", response_model=list[StandardRead], tags=["standards"])
def list_standards(q: str | None = None, db: Session = Depends(get_db), _: User = Depends(require_permission(Permission.TENDER_READ))) -> list:
    query = select(Standard)
    if q:
        query = query.where(Standard.official_title.ilike(f"%{q}%"))
    return list(db.scalars(query.limit(50)).all())


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
    extracted = extract_requirements(tender.source_text)
    for item in extracted:
        db.add(TenderRequirement(
            tender_id=tender.id,
            requirement_type=item.requirement_type,
            value=item.value,
            confidence=item.confidence,
            source_excerpt=item.source_excerpt,
            needs_confirmation=item.needs_confirmation,
        ))
    candidates = find_candidates(db, tender.source_text)
    if candidates:
        # Highest-ranked retrieval hit is the primary; the rest matched on text
        # alone, so they are allied candidates rather than primary standards.
        for position, candidate in enumerate(candidates):
            candidate.standard_type = "primary" if position == 0 else "allied"
        # Graph traversal then re-labels anything linked to the primary and adds
        # normative references or test methods that retrieval missed.
        candidates = apply_graph_context(db, candidates)

    response_items: list[RecommendationRead] = []
    for candidate in candidates:
        standard = candidate.standard
        qco = evaluate_qco(db, tender.source_text, standard)
        verified = standard.verification_status == VerificationStatus.verified and bool(standard.standard_number and standard.official_source_url)
        warning = None if verified else "Demonstration or unverified record. Do not cite in a tender."
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
            **_currency_fields(standard),
        ))
    tender.status = "review_required"
    db.add(AuditLog(actor_id=actor_id, action="tender.analysis.completed", entity_type="tender", entity_id=str(tender.id), details={"candidate_count": len(response_items), "retrieval_mode": retrieval_mode()}))
    db.commit()
    guardrail = None if response_items else "No verified recommendation found. Expert review is required."
    gaps = missing_requirements(tender.source_text)
    # The prose briefing is deliberately NOT generated here. Local generation
    # takes tens of seconds, and an officer should see evidence immediately
    # rather than wait on a description of it. The dashboard requests the
    # briefing separately once results are on screen.
    return AnalysisResponse(
        tender=TenderRead.model_validate(tender),
        recommendations=response_items,
        extracted_requirements=extracted,
        missing_requirements=gaps,
        outdated_citations=[OutdatedCitation(**item) for item in outdated_citations(db, tender.source_text)],
        guardrail_message=guardrail,
        retrieval_mode=retrieval_mode(),
        embedding_model=semantic_index.model_name,
        officer_summary_status="pending" if settings.enable_llm_explanations else "disabled",
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
            warning=None if verified else "Demonstration or unverified record. Do not cite in a tender.",
            relation_note=item.relation_note,
            score_breakdown=item.score_breakdown or {},
            **_currency_fields(item.standard),
        ))
    guardrail = None if recommendations else "No verified recommendation found. Expert review is required."
    extracted = list(db.scalars(select(TenderRequirement).where(TenderRequirement.tender_id == tender.id)).all())
    return AnalysisResponse(
        tender=TenderRead.model_validate(tender),
        recommendations=recommendations,
        extracted_requirements=extracted,
        missing_requirements=missing_requirements(tender.source_text),
        outdated_citations=[OutdatedCitation(**item) for item in outdated_citations(db, tender.source_text)],
        guardrail_message=guardrail,
        retrieval_mode=retrieval_mode(),
        embedding_model=semantic_index.model_name,
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
    except Exception as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Document extraction failed: {exc}") from exc
    tender = Tender(
        reference=f"MS-{datetime.now(timezone.utc):%Y}-{uuid4().hex[:6].upper()}",
        title=Path(file.filename or "Untitled tender").stem,
        filename=destination.name,
        source_text=extraction.text,
        status="ocr_required" if extraction.requires_ocr else "extracted",
        created_by_id=user.id,
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
    summary = explain_analysis(tender.source_text, analysis.recommendations, analysis.missing_requirements)
    return BriefingResponse(
        officer_summary=summary.text,
        officer_summary_status=summary.status,
        officer_summary_model=summary.model,
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


@app.get("/api/v1/audit", response_model=list[AuditRead], tags=["audit"])
def audit_history(db: Session = Depends(get_db), _: User = Depends(require_permission(Permission.AUDIT_READ))) -> list[AuditLog]:
    return list(db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(200)).all())


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
