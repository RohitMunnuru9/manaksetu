import pytest

from app.services.embeddings import semantic_index
from app.services.requirements import detect_language, extract_requirements


def _product(text: str):
    return next((item for item in extract_requirements(text) if item.requirement_type == "product"), None)


needs_model = pytest.mark.skipif(
    not semantic_index.available,
    reason="embedding model unavailable; semantic product classification disabled",
)


def test_structured_requirement_extraction() -> None:
    text = "Purchase 1,000 industrial safety helmets for construction workers with impact testing, permanent marking and a two-year warranty. Reference IS 2925:1984."
    results = extract_requirements(text)
    values = {item.requirement_type: item.value for item in results}
    assert values["product"] == "safety helmet"
    assert values["quantity"] == "1000"
    assert values["intended_use"] == "construction site"
    assert "impact testing" in values["testing"]
    assert values["existing_standard_reference"] == "IS 2925:1984"


def test_unicode_language_detection() -> None:
    assert detect_language("औद्योगिक सुरक्षा हेलमेट खरीद") == "hi"
    assert detect_language("పారిశ్రామిక భద్రత హెల్మెట్") == "te"
    assert detect_language("industrial safety helmet") == "en"


def test_indic_tenders_resolve_their_product() -> None:
    """Hindi and Telugu tenders must not report an unidentified product."""
    hindi = _product("औद्योगिक सुरक्षा हेलमेट निर्माण श्रमिकों के लिए खरीद")
    telugu = _product("పారిశ్రామిక భద్రతా హెల్మెట్ నిర్మాణ కార్మికుల కోసం")
    assert hindi is not None and hindi.value == "safety helmet"
    assert telugu is not None and telugu.value == "safety helmet"


@needs_model
def test_unlisted_english_phrasing_falls_back_to_semantic_match() -> None:
    """No listed term appears here; only meaning connects it to a helmet."""
    text = "Supply of cranial impact protection equipment for site personnel."
    product = _product(text)
    assert product is not None and product.value == "safety helmet"
    # An inference, not a quotation, so the officer must confirm it.
    assert product.needs_confirmation is True
    assert product.confidence < 0.9


def test_literal_match_is_reported_as_confirmed() -> None:
    product = _product("Purchase 1,000 industrial safety helmet units for construction workers.")
    assert product is not None and product.needs_confirmation is False


def test_unrelated_tender_reports_no_product_rather_than_guessing() -> None:
    assert _product("Procurement of artisanal sourdough starter cultures for the canteen.") is None
