import pytest

from app.services.requirements import detect_language, extract_requirements
from app.services.subject import extract_subject


def _product(text: str, vocabulary=None):
    return next(
        (item for item in extract_requirements(text, vocabulary) if item.requirement_type == "product"),
        None,
    )


class _Vocabulary:
    """Stands in for the catalogue's word statistics.

    `weight` is inverse document frequency: a word naming few standards
    identifies goods, a word naming many identifies nothing.
    """

    def __init__(self, frequencies: dict[str, int], total: int = 1000):
        self.frequencies = frequencies
        self.total = total

    def weight(self, word: str) -> float:
        import math

        seen = self.frequencies.get(word, 0)
        return math.log(self.total / seen) if seen else 0.0


def test_structured_requirement_extraction() -> None:
    text = (
        "Sub: Purchase of 1,000 industrial safety helmets for construction workers "
        "with impact testing, permanent marking and a two-year warranty. Reference IS 2925:1984."
    )
    results = extract_requirements(text)
    values = {item.requirement_type: item.value for item in results}
    assert "safety helmet" in values["product"].lower()
    assert values["quantity"] == "1000"
    assert values["intended_use"] == "construction site"
    assert "impact testing" in values["testing"]
    assert values["existing_standard_reference"] == "IS 2925:1984"


def test_unicode_language_detection() -> None:
    assert detect_language("औद्योगिक सुरक्षा हेलमेट खरीद") == "hi"
    assert detect_language("పారిశ్రామిక భద్రత హెల్మెట్") == "te"
    assert detect_language("தொழில்துறை பாதுகாப்பு தலைக்கவசம்") == "ta"
    assert detect_language("নিরাপত্তা হেলমেট ক্রয়") == "bn"
    assert detect_language("ಸುರಕ್ಷತಾ ಹೆಲ್ಮೆಟ್ ಖರೀದಿ") == "kn"
    assert detect_language("industrial safety helmet") == "en"


def test_product_is_whatever_the_tender_says_it_is() -> None:
    """The system holds no list of known products.

    Anything a tender can be for must survive extraction, including goods
    nobody anticipated. This is the regression that mattered: a notice for
    blood bank incubators was previously reported as "electric cable" because
    only six product categories existed and one of them had to win.
    """
    product = _product(
        "Sub: Procurement of Blood Bank Incubators, Hi-loop electrical sterilizer and "
        "Automatic vertical autoclave 75 litres for use at Blood bank centre - Reg."
    )
    assert product is not None
    lowered = product.value.lower()
    assert "blood bank incubator" in lowered
    assert "cable" not in lowered
    # A stated subject line is a quotation, not an inference.
    assert product.needs_confirmation is False


def test_stated_subject_beats_repetition_elsewhere() -> None:
    """A word repeated through the conditions of contract must not outrank the
    subject the document states once, at the top, where subjects live."""
    text = (
        "Sub: Procurement of Blood Bank Incubators for SCCL hospitals - Reg. "
        + "The contractor shall lay cable as per the cable schedule. " * 40
    )
    product = _product(text)
    assert product is not None
    assert "blood bank incubator" in product.value.lower()


def test_indic_tenders_carry_their_own_subject() -> None:
    """An Indic tender must describe itself in its own words, not be mapped
    onto an English category."""
    hindi = _product("विषय: औद्योगिक सुरक्षा हेलमेट की खरीद निर्माण श्रमिकों के लिए")
    assert hindi is not None and "हेलमेट" in hindi.value

    tamil = _product("பொருள்: கட்டுமான தொழிலாளர்களுக்கு பாதுகாப்பு தலைக்கவசம் கொள்முதல்")
    assert tamil is not None and "தலைக்கவசம்" in tamil.value


def test_typed_description_is_its_own_subject() -> None:
    product = _product("Purchase of 500 industrial safety helmets for construction workers.")
    assert product is not None
    assert "safety helmet" in product.value.lower()


def test_empty_document_reports_no_subject() -> None:
    assert _product("") is None
    assert _product("   \n  ") is None


def test_long_document_without_a_subject_line_prefers_distinctive_words() -> None:
    """With no stated subject, frequency alone picks the words every tender
    contains. Weighting by how rare a word is across the catalogue is what
    separates the goods from the paperwork."""
    text = (
        "GENERAL CONDITIONS OF CONTRACT. "
        + "The contractor and the engineer shall agree the specification. " * 120
        + "Ordinary portland cement shall be used throughout. " * 60
    )
    # Reality, not invention: no published standard is titled "contractor" or
    # "engineer", so those carry no weight at all and are dropped outright.
    # That presence test, rather than the ranking, is what removes paperwork.
    vocabulary = _Vocabulary(
        {"specification": 500, "cement": 20, "portland": 12},
        total=1000,
    )
    product = _product(text, vocabulary)
    assert product is not None
    lowered = product.value.lower()
    assert "cement" in lowered
    assert "contractor" not in lowered
    # An inference from repetition, never presented as the document's own words.
    assert product.needs_confirmation is True


def test_subject_line_is_trimmed_of_reference_numbers() -> None:
    subject = extract_subject(
        "Sub: Supply of packaged drinking water to offices - Reg. Enquiry Number E0326O0110 dated 18.08.2026"
    )
    assert subject.source == "stated"
    assert "packaged drinking water" in subject.text.lower()
    assert "enquiry" not in subject.text.lower()
    assert "e0326o0110" not in subject.text.lower()
