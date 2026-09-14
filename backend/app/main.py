from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .config import get_settings
from .database import Base, SessionLocal, engine, get_db
from .models import AuditLog, Recommendation, Standard, Tender, User, VerificationStatus
from .schemas import AnalysisResponse, HealthResponse, LoginRequest, RecommendationRead, StandardRead, TenderCreate, TenderRead, TokenResponse
from .security import create_access_token, verify_password
from .seed import seed_demo_data
from .services.recommendation import confidence_level, evaluate_qco, find_candidates, missing_requirements

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        seed_demo_data(db)
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
def health(db: Session = Depends(get_db)) -> HealthResponse:
    db.execute(text("SELECT 1"))
    return HealthResponse(status="healthy", service=settings.app_name, database="connected")


@app.post("/api/v1/auth/login", response_model=TokenResponse, tags=["auth"])
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower()))
    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    db.add(AuditLog(actor_id=user.id, action="user.login", entity_type="user", entity_id=str(user.id)))
    db.commit()
    return TokenResponse(access_token=create_access_token(str(user.id)))


@app.get("/api/v1/standards", response_model=list[StandardRead], tags=["standards"])
def list_standards(q: str | None = None, db: Session = Depends(get_db)) -> list:
    query = select(Standard)
    if q:
        query = query.where(Standard.official_title.ilike(f"%{q}%"))
    return list(db.scalars(query.limit(50)).all())


def run_analysis(db: Session, tender: Tender) -> AnalysisResponse:
    candidates = find_candidates(db, tender.source_text)
    response_items: list[RecommendationRead] = []
    for index, candidate in enumerate(candidates):
        standard = candidate.standard
        qco = evaluate_qco(db, tender.source_text, standard)
        verified = standard.verification_status == VerificationStatus.verified and bool(standard.standard_number and standard.official_source_url)
        warning = None if verified else "Demonstration or unverified record. Do not cite in a tender."
        score = candidate.score if verified else min(candidate.score, 0.69)
        recommendation = Recommendation(
            tender_id=tender.id,
            standard_id=standard.id,
            standard_type="primary" if index == 0 else "allied",
            reason="Matched against curated title and scope metadata.",
            matched_requirements=candidate.matched_terms,
            confidence_score=score,
            human_review_required=True,
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
            human_review_required=True,
            warning=warning,
        ))
    tender.status = "review_required"
    db.add(AuditLog(action="tender.analysis.completed", entity_type="tender", entity_id=str(tender.id), details={"candidate_count": len(response_items)}))
    db.commit()
    guardrail = None if response_items else "No verified recommendation found. Expert review is required."
    return AnalysisResponse(tender=TenderRead.model_validate(tender), recommendations=response_items, missing_requirements=missing_requirements(tender.source_text), guardrail_message=guardrail)


@app.post("/api/v1/tenders/analyse", response_model=AnalysisResponse, tags=["tenders"])
def analyse_text(payload: TenderCreate, db: Session = Depends(get_db)) -> AnalysisResponse:
    tender = Tender(reference=f"MS-{datetime.now(timezone.utc):%Y}-{uuid4().hex[:6].upper()}", title=payload.title, source_text=payload.description, language=payload.language)
    db.add(tender)
    db.flush()
    return run_analysis(db, tender)


@app.post("/api/v1/tenders/upload", response_model=TenderRead, tags=["tenders"])
async def upload_tender(file: UploadFile = File(...), db: Session = Depends(get_db)) -> Tender:
    allowed = {"application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=415, detail="Only PDF, DOCX, and TXT files are accepted")
    content = await file.read(settings.max_upload_mb * 1024 * 1024 + 1)
    if len(content) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {settings.max_upload_mb} MB")
    safe_name = f"{uuid4().hex}_{Path(file.filename or 'tender').name}"
    (settings.upload_dir / safe_name).write_bytes(content)
    tender = Tender(reference=f"MS-{datetime.now(timezone.utc):%Y}-{uuid4().hex[:6].upper()}", title=Path(file.filename or "Untitled tender").stem, filename=safe_name, status="uploaded")
    db.add(tender)
    db.commit()
    db.refresh(tender)
    return tender
