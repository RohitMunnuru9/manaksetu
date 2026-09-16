from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum

from sqlalchemy import Boolean, Date, DateTime, Enum as SqlEnum, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class VerificationStatus(str, Enum):
    verified = "verified"
    pending = "pending"
    demo = "demo"


class StandardStatus(str, Enum):
    current = "current"
    revised = "revised"
    withdrawn = "withdrawn"
    uncertain = "uncertain"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(80), default="procurement_officer")
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ProductCategory(Base):
    __tablename__ = "product_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    standards: Mapped[list[Standard]] = relationship(back_populates="category")


class Standard(Base):
    __tablename__ = "standards"

    id: Mapped[int] = mapped_column(primary_key=True)
    standard_number: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True, index=True)
    # Internal handle for every record, verified or not. Unverified records have
    # no IS number by design, so this gives each one a distinct, citable-in-house
    # reference that can never be mistaken for a published Indian Standard.
    catalogue_ref: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    official_title: Mapped[str] = mapped_column(String(500), index=True)
    scope_summary: Mapped[str] = mapped_column(Text, default="")
    publication_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reaffirmation_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    revision_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[StandardStatus] = mapped_column(SqlEnum(StandardStatus), default=StandardStatus.uncertain)
    technical_committee: Mapped[str | None] = mapped_column(String(160), nullable=True)
    official_source_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    source_organisation: Mapped[str | None] = mapped_column(String(160), nullable=True)
    retrieved_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_checked_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    verification_status: Mapped[VerificationStatus] = mapped_column(SqlEnum(VerificationStatus), default=VerificationStatus.pending)
    content_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("product_categories.id"), nullable=True)
    category: Mapped[ProductCategory | None] = relationship(back_populates="standards")
    # Stored as JSON so the same schema works on SQLite and PostgreSQL. The
    # catalogue is small enough that cosine similarity runs in-process; moving
    # this to a pgvector column is the production upgrade path.
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)


class StandardRelationship(Base):
    """Directed edge between two standards.

    This is the Postgres-only substitute for the Neo4j knowledge graph that the
    specification allows. It lets a primary standard pull in its normative
    references, test methods and safety standards without a second database.
    """

    __tablename__ = "standard_relationships"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("standards.id"), index=True)
    target_id: Mapped[int] = mapped_column(ForeignKey("standards.id"), index=True)
    relationship_type: Mapped[str] = mapped_column(String(40), index=True)
    source: Mapped[Standard] = relationship(foreign_keys=[source_id])
    target: Mapped[Standard] = relationship(foreign_keys=[target_id])


class QualityControlOrder(Base):
    __tablename__ = "quality_control_orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    product_keyword: Mapped[str] = mapped_column(String(160), index=True)
    mandated_standard_id: Mapped[int] = mapped_column(ForeignKey("standards.id"))
    enforcement_date: Mapped[date] = mapped_column(Date)
    official_source_url: Mapped[str] = mapped_column(String(1000))
    verification_status: Mapped[VerificationStatus] = mapped_column(SqlEnum(VerificationStatus), default=VerificationStatus.pending)
    exemptions: Mapped[list[str]] = mapped_column(JSON, default=list)


class Tender(Base):
    __tablename__ = "tenders"

    id: Mapped[int] = mapped_column(primary_key=True)
    reference: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    source_text: Mapped[str] = mapped_column(Text, default="")
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="received")
    language: Mapped[str] = mapped_column(String(20), default="en")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    recommendations: Mapped[list[Recommendation]] = relationship(back_populates="tender", cascade="all, delete-orphan")


class TenderRequirement(Base):
    __tablename__ = "tender_requirements"

    id: Mapped[int] = mapped_column(primary_key=True)
    tender_id: Mapped[int] = mapped_column(ForeignKey("tenders.id"), index=True)
    requirement_type: Mapped[str] = mapped_column(String(80), index=True)
    value: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float)
    source_excerpt: Mapped[str] = mapped_column(Text, default="")
    needs_confirmation: Mapped[bool] = mapped_column(Boolean, default=True)


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    tender_id: Mapped[int] = mapped_column(ForeignKey("tenders.id"))
    standard_id: Mapped[int] = mapped_column(ForeignKey("standards.id"))
    standard_type: Mapped[str] = mapped_column(String(40), default="primary")
    reason: Mapped[str] = mapped_column(Text)
    matched_requirements: Mapped[list[str]] = mapped_column(JSON, default=list)
    confidence_score: Mapped[float] = mapped_column(Float)
    human_review_required: Mapped[bool] = mapped_column(Boolean, default=True)
    # Kept so the officer can see which retrieval channel produced the result,
    # and so a saved analysis replays identically to the original run.
    score_breakdown: Mapped[dict] = mapped_column(JSON, default=dict)
    relation_note: Mapped[str | None] = mapped_column(String(300), nullable=True)
    tender: Mapped[Tender] = relationship(back_populates="recommendations")
    standard: Mapped[Standard] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(120), index=True)
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(80))
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ReviewDecision(Base):
    __tablename__ = "review_decisions"

    id: Mapped[int] = mapped_column(primary_key=True)
    tender_id: Mapped[int] = mapped_column(ForeignKey("tenders.id"), index=True)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decision: Mapped[str] = mapped_column(String(40))
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
