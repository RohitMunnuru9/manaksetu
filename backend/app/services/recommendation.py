import re
from dataclasses import dataclass
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import QualityControlOrder, Standard, VerificationStatus


TOKEN_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9-]{2,}")
STOP_WORDS = {"and", "the", "for", "with", "from", "that", "this", "units", "purchase", "supply"}


@dataclass
class RankedStandard:
    standard: Standard
    score: float
    matched_terms: list[str]


def extract_terms(text: str) -> list[str]:
    return sorted({match.group(0).lower() for match in TOKEN_RE.finditer(text) if match.group(0).lower() not in STOP_WORDS})


def find_candidates(db: Session, text: str, limit: int = 5) -> list[RankedStandard]:
    terms = extract_terms(text)
    if not terms:
        return []
    clauses = [Standard.official_title.ilike(f"%{term}%") for term in terms]
    clauses += [Standard.scope_summary.ilike(f"%{term}%") for term in terms]
    standards = db.scalars(select(Standard).where(or_(*clauses))).all()
    ranked: list[RankedStandard] = []
    for standard in standards:
        searchable = f"{standard.official_title} {standard.scope_summary}".lower()
        matched = [term for term in terms if term in searchable]
        lexical = min(len(matched) / max(len(terms), 1), 1.0)
        verification_boost = 0.15 if standard.verification_status == VerificationStatus.verified else 0.0
        freshness_boost = 0.05 if standard.last_checked_date else 0.0
        score = round(min(0.35 + lexical * 0.45 + verification_boost + freshness_boost, 0.99), 2)
        ranked.append(RankedStandard(standard, score, matched))
    return sorted(ranked, key=lambda item: item.score, reverse=True)[:limit]


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
