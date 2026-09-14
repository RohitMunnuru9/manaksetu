from app.services.requirements import detect_language, extract_requirements


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
