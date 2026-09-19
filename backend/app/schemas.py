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
    # Sent so the interface can hide actions the role cannot perform. The API
    # still enforces every one of them server-side; this is presentation only.
    permissions: list[str] = Field(default_factory=list)


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
    # The text as the system read it, so an officer can see exactly what was
    # analysed -- including what OCR made of a scanned page.
    source_text: str = ""


class StandardRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    standard_number: str | None
    catalogue_ref: str | None
    official_title: str
    scope_summary: str
    publication_year: int | None
    status: StandardStatus
    official_source_url: str | None
    last_checked_date: date | None
    verification_status: VerificationStatus


class AmendmentRead(BaseModel):
    amendment_number: str
    issued_date: str | None = None
    summary: str = ""
    official_source_url: str | None = None


class OutdatedCitation(BaseModel):
    """A standard the tender itself cites that the catalogue knows is outdated."""
    cited_standard: str
    status: str
    superseded_by: str | None = None
    amendment_count: int = 0
    message: str | None = None


class EvidenceSpanRead(BaseModel):
    """A passage of the officer's own tender that drove a match. String-matched
    against the stored text, never paraphrased, so highlighting cannot lie."""
    text: str
    start: int
    end: int
    terms: list[str] = Field(default_factory=list)


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
    relation_note: str | None = None
    score_breakdown: dict[str, float] = Field(default_factory=dict)
    # Currency of the record itself, decided deterministically.
    is_outdated: bool = False
    superseded_by: str | None = None
    amendments: list[AmendmentRead] = Field(default_factory=list)
    currency_warning: str | None = None
    # Clause-level traceability: where in the tender this match came from.
    evidence_spans: list[EvidenceSpanRead] = Field(default_factory=list)


class NearestRecord(BaseModel):
    """Shown only when nothing matched. Explicitly not a recommendation."""
    standard: StandardRead
    similarity: float


class ExtractedRequirement(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    requirement_type: str
    value: str
    confidence: float
    source_excerpt: str
    needs_confirmation: bool


class ScoreRowRead(BaseModel):
    key: str
    label: str
    weight: int
    satisfied: bool
    evidence: str | None = None
    fix: str | None = None


class ScorecardRead(BaseModel):
    """Deterministic completeness score for the specification document itself."""
    score: int
    grade: str
    rows: list[ScoreRowRead] = Field(default_factory=list)
    fixes: list[str] = Field(default_factory=list)


class AnalysisResponse(BaseModel):
    tender: TenderRead
    recommendations: list[RecommendationRead]
    extracted_requirements: list[ExtractedRequirement] = Field(default_factory=list)
    missing_requirements: list[str]
    # Outdated standards the tender text already cites.
    outdated_citations: list[OutdatedCitation] = Field(default_factory=list)
    guardrail_message: str | None = None
    # Populated only when recommendations is empty. Kept in its own field so
    # nothing can mistake these for results.
    nearest_records: list[NearestRecord] = Field(default_factory=list)
    # "hybrid" when the local embedding model is loaded, "lexical" when the
    # system is running on keyword matching alone. Surfaced so the interface
    # never claims semantic retrieval that did not actually run.
    retrieval_mode: str = "lexical"
    embedding_model: str | None = None
    scorecard: ScorecardRead | None = None
    # Optional prose briefing from the local model. Never a source of fact: it
    # is discarded entirely if it mentions an identifier that was not retrieved.
    officer_summary: str | None = None
    officer_summary_status: str = "disabled"
    officer_summary_model: str | None = None


class BriefingResponse(BaseModel):
    """Prose only. Requested after an analysis is already on screen."""
    officer_summary: str | None = None
    officer_summary_status: str = "disabled"
    officer_summary_model: str | None = None


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
    total_standards: int
    completed_reviews: int


class NetworkNode(BaseModel):
    """One record in the standards network, positioned for drawing."""
    id: str
    label: str
    identifier: str | None = None
    # product | standard | test | safety | certification | regulatory | revision
    kind: str
    tier: str = "example"
    is_centre: bool = False


class NetworkEdge(BaseModel):
    source: str
    target: str
    label: str
    dashed: bool = False


class NetworkResponse(BaseModel):
    centre_id: str
    nodes: list[NetworkNode]
    edges: list[NetworkEdge]
    linked_standards: int = 0
    official_source_verified: bool = False
    current_version_confirmed: bool = False


class CategoryRead(BaseModel):
    """A product area the catalogue covers, with how much is in it."""
    name: str
    description: str = ""
    record_count: int = 0
    verified_count: int = 0


class DraftResponse(BaseModel):
    """Specification clauses grounded in retrieved standards only."""
    clauses: str
    source: str = "deterministic"
    identifiers_used: list[str] = Field(default_factory=list)
    note: str = ""


class TopStandard(BaseModel):
    identifier: str
    title: str
    count: int


class SectorCount(BaseModel):
    name: str
    count: int


class WatchItem(BaseModel):
    """A standard in active use whose currency needs attention."""
    standard_id: int
    identifier: str
    title: str
    issue: str
    detail: str


class AnalyticsResponse(BaseModel):
    total_tenders: int
    total_standards: int
    verified_standards: int
    pending_standards: int
    demo_records: int
    tenders_by_language: dict[str, int] = Field(default_factory=dict)
    top_standards: list[TopStandard] = Field(default_factory=list)
    top_sectors: list[SectorCount] = Field(default_factory=list)
    watch: list[WatchItem] = Field(default_factory=list)
    expiring_within_180_days: int = 0
