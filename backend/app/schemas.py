from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from .models import StandardStatus, VerificationStatus


class HealthResponse(BaseModel):
    status: str
    service: str
    database: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    full_name: str
    role: str


class TenderCreate(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    description: str = Field(min_length=10, max_length=50_000)
    language: str = Field(default="en", max_length=20)


class TenderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    reference: str
    title: str
    status: str
    language: str
    filename: str | None
    created_at: datetime


class StandardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    standard_number: str | None
    official_title: str
    scope_summary: str
    publication_year: int | None
    status: StandardStatus
    official_source_url: str | None
    last_checked_date: date | None
    verification_status: VerificationStatus


class RecommendationRead(BaseModel):
    standard: StandardRead
    standard_type: str
    reason_for_recommendation: str
    matched_requirements: list[str]
    confidence_score: float
    confidence_level: str
    certification_required: bool
    qco_applicable: bool
    qco_title: str | None = None
    qco_enforcement_date: date | None = None
    qco_source_url: str | None = None
    human_review_required: bool
    warning: str | None = None


class ExtractedRequirement(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    requirement_type: str
    value: str
    confidence: float
    source_excerpt: str
    needs_confirmation: bool


class AnalysisResponse(BaseModel):
    tender: TenderRead
    recommendations: list[RecommendationRead]
    extracted_requirements: list[ExtractedRequirement] = Field(default_factory=list)
    missing_requirements: list[str]
    guardrail_message: str | None = None


class ReviewCreate(BaseModel):
    decision: str = Field(pattern="^(approved|rejected|expert_review)$")
    note: str = Field(default="", max_length=5_000)


class ReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    tender_id: int
    decision: str
    note: str
    created_at: datetime


class AuditRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    action: str
    entity_type: str
    entity_id: str
    details: dict
    created_at: datetime


class DashboardStats(BaseModel):
    total_tenders: int
    pending_reviews: int
    verified_standards: int
    completed_reviews: int
