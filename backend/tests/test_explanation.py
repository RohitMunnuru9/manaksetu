"""Tests for the local language-model explanation layer.

These do not require Ollama to be running. The transport is stubbed, because
what needs proving is the validation that runs on whatever the model returns.
"""

from dataclasses import dataclass

import httpx
import pytest

from app.config import get_settings
from app.services import explanation as explanation_module
from app.services.explanation import (
    build_evidence_block,
    explain_analysis,
    normalise_identifier,
    validate_explanation,
)


# --- Fakes mirroring the shape of a RecommendationRead ------------------

@dataclass
class FakeStandard:
    official_title: str
    verification_status: str = "demo"
    standard_number: str | None = None
    catalogue_ref: str | None = "MS-DEMO-RECORD"


@dataclass
class FakeRecommendation:
    standard: FakeStandard
    standard_type: str = "primary"
    confidence_score: float = 0.72
    certification_required: bool = False
    qco_title: str | None = None


def verified_candidate(certification: bool = False) -> FakeRecommendation:
    return FakeRecommendation(
        standard=FakeStandard(
            official_title="Specification for industrial safety helmets",
            verification_status="verified",
            standard_number="IS 2925:1984",
            catalogue_ref="MS-PPE-HELMET-PRIMARY",
        ),
        certification_required=certification,
        qco_title="Helmet QCO 2023" if certification else None,
    )


def demo_candidate() -> FakeRecommendation:
    return FakeRecommendation(
        standard=FakeStandard(official_title="Protective headgear test methods", catalogue_ref="MS-PPE-HELMET-TEST"),
        standard_type="test",
    )


# --- Identifier validation ---------------------------------------------

def test_identifier_comparison_ignores_spacing_and_punctuation() -> None:
    for variant in ("IS 2925:1984", "IS2925:1984", "IS 2925 : 1984", "is  2925-1984"):
        assert normalise_identifier(variant) == normalise_identifier("IS 2925:1984")


def test_explanation_quoting_a_supplied_identifier_is_accepted() -> None:
    text = "IS 2925:1984 covers industrial safety helmets and matches this tender."
    acceptable, invented = validate_explanation(text, ["IS 2925:1984"], False)
    assert acceptable and invented == []


@pytest.mark.parametrize("fabricated", [
    "IS 4151:2015",      # a plausible-looking number that was never supplied
    "IS 2925:1990",      # the right standard, a fabricated year
    "IS 9873",           # unrelated
    "IS/ISO 3873:1977",  # an international-style reference
])
def test_any_unsupplied_identifier_discards_the_whole_explanation(fabricated: str) -> None:
    """This is the guarantee: a fabricated citation never reaches the officer."""
    text = f"IS 2925:1984 applies here, and you should also reference {fabricated}."
    acceptable, invented = validate_explanation(text, ["IS 2925:1984"], False)
    assert acceptable is False
    assert any(normalise_identifier(fabricated) == normalise_identifier(item) for item in invented)


def test_explanation_naming_an_unverified_record_by_reference_is_accepted() -> None:
    text = "MS-PPE-HELMET-TEST is an unverified record and must be confirmed before use."
    acceptable, invented = validate_explanation(text, ["IS 2925:1984"], False)
    assert acceptable and invented == []


def test_unsupported_certification_claim_is_rejected() -> None:
    text = "IS 2925:1984 applies and mandatory certification is required for this purchase."
    acceptable, _ = validate_explanation(text, ["IS 2925:1984"], certification_is_mandatory=False)
    assert acceptable is False


def test_certification_claim_is_allowed_when_the_rule_engine_confirmed_it() -> None:
    text = "IS 2925:1984 applies and mandatory certification is required for this purchase."
    acceptable, _ = validate_explanation(text, ["IS 2925:1984"], certification_is_mandatory=True)
    assert acceptable is True


# --- Evidence construction ---------------------------------------------

def test_unverified_records_contribute_no_permitted_identifier() -> None:
    evidence, allowed, mandatory = build_evidence_block([verified_candidate(), demo_candidate()])
    assert allowed == ["IS 2925:1984"], "only verified records may be cited by number"
    assert "MS-PPE-HELMET-TEST" in evidence
    assert "UNVERIFIED" in evidence
    assert mandatory is False


def test_mandatory_certification_is_passed_through_as_evidence() -> None:
    evidence, _, mandatory = build_evidence_block([verified_candidate(certification=True)])
    assert mandatory is True
    assert "CERTIFICATION: MANDATORY" in evidence


# --- End to end with a stubbed transport --------------------------------

def _stub_ollama(monkeypatch, reply: str) -> None:
    def fake_post(url, **kwargs):
        return httpx.Response(200, json={"message": {"content": reply}}, request=httpx.Request("POST", url))
    monkeypatch.setattr(explanation_module.httpx, "post", fake_post)


@pytest.fixture
def llm_enabled(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "enable_llm_explanations", True)
    return settings


def test_clean_model_output_is_returned(monkeypatch, llm_enabled) -> None:
    _stub_ollama(monkeypatch, "IS 2925:1984 is the primary specification for industrial safety helmets and fits this tender.")
    result = explain_analysis("Purchase safety helmets", [verified_candidate()], [])
    assert result.ok and result.status == "generated"


def test_model_output_with_a_fabricated_number_is_discarded(monkeypatch, llm_enabled) -> None:
    _stub_ollama(monkeypatch, "You should cite IS 2925:1984 together with IS 4151:2015 for this purchase.")
    result = explain_analysis("Purchase safety helmets", [verified_candidate()], [])
    assert result.ok is False
    assert result.status == "rejected_invented_identifier"
    assert result.text is None, "rejected output must not reach the officer"


def test_unreachable_ollama_degrades_quietly(monkeypatch, llm_enabled) -> None:
    def fake_post(url, **kwargs):
        raise httpx.ConnectError("connection refused")
    monkeypatch.setattr(explanation_module.httpx, "post", fake_post)
    result = explain_analysis("Purchase safety helmets", [verified_candidate()], [])
    assert result.ok is False and result.status == "unavailable"


def test_timeout_degrades_quietly(monkeypatch, llm_enabled) -> None:
    def fake_post(url, **kwargs):
        raise httpx.ReadTimeout("too slow")
    monkeypatch.setattr(explanation_module.httpx, "post", fake_post)
    result = explain_analysis("Purchase safety helmets", [verified_candidate()], [])
    assert result.ok is False and result.status == "timeout"


def test_layer_is_inert_when_disabled(monkeypatch) -> None:
    monkeypatch.setattr(get_settings(), "enable_llm_explanations", False)
    result = explain_analysis("Purchase safety helmets", [verified_candidate()], [])
    assert result.ok is False and result.status == "disabled"
