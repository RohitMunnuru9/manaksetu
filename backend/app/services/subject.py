"""What is this tender actually for?

Every earlier version of this answered with one of six hardcoded product
categories. That was survivable when the catalogue held thirty-four records.
With 2,914 standards across 215 BIS sectors it is indefensible, and it failed
exactly as you would expect: a forty-nine page notice for *Blood Bank
Incubators, sterilisers and autoclaves* was reported as "electric cable",
because the word "cable" appears forty-six times in the general conditions
while "blood" appears twelve times in the part that matters.

Nothing here knows what a helmet or a cable is. It reads the tender the way a
procurement officer does -- by looking for the line where the document states
its own subject. Indian government tenders are highly conventional about this:
there is nearly always a "Sub:", "Subject:", "Name of work:" or "Procurement
of ..." near the top, and that line is worth more than the rest of the document
put together.

If no such line exists, the opening sentences are used, flagged as an
inference. If even that yields nothing usable, the honest answer is that the
subject could not be determined, and retrieval says so rather than guessing.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

from .vocabulary import STOP_WORDS

# How a tender announces its own subject. These are document conventions, not
# product knowledge: the same markers introduce a subject whether the tender is
# for cement, incubators or anything else. Indic equivalents are included so a
# tender written in an Indian language is read the same way.
SUBJECT_MARKERS = (
    r"sub(?:ject)?\s*[:\-]",
    r"name\s+of\s+(?:the\s+)?work\s*[:\-]",
    r"name\s+of\s+(?:the\s+)?(?:item|store|material|equipment)s?\s*[:\-]",
    r"description\s+of\s+(?:the\s+)?(?:work|item|store|material)s?\s*[:\-]",
    r"tender\s+for\s*[:\-]?",
    r"(?:e-)?tender\s+(?:is\s+)?invited\s+for\s*[:\-]?",
    r"notice\s+inviting\s+(?:e-)?tender\s+for\s*[:\-]?",
    r"विषय\s*[:\-]",
    r"कार्य\s+का\s+नाम\s*[:\-]",
    r"విషయం\s*[:\-]",
    r"பொருள்\s*[:\-]",
    r"বিষয়\s*[:\-]",
    r"ವಿಷಯ\s*[:\-]",
    r"വിഷയം\s*[:\-]",
)

# Phrases that introduce the thing being bought without introducing a labelled
# subject line. Used only to trim a subject once found, or as a weaker locator.
PROCUREMENT_VERBS = (
    r"procurement\s+of",
    r"supply\s+(?:and\s+installation\s+)?of",
    r"purchase\s+of",
    r"supplying\s+of",
    r"hiring\s+of",
    r"providing\s+(?:and\s+)?(?:fixing\s+)?of",
    r"installation\s+of",
    r"खरीद",
    r"आपूर्ति",
    r"కొనుగోలు",
    r"கொள்முதல்",
)

_MARKER_RE = re.compile("|".join(SUBJECT_MARKERS), re.IGNORECASE)
_VERB_RE = re.compile("|".join(PROCUREMENT_VERBS), re.IGNORECASE)

# Where a subject line stops. Tenders run the subject into a reference number,
# a date or a "-Reg." sign-off, none of which describe the goods.
_SUBJECT_END = re.compile(
    r"(?:\s[-–—]\s*reg\.?\b"
    r"|\benquiry\s+(?:number|no)\b"
    r"|\btender\s+(?:id|no|number)\b"
    r"|\bref(?:erence)?\s*(?:no|number)?\s*[:\-]"
    r"|\bdated?\b\s*[:\-]?\s*\d"
    r"|\bdue\s+(?:on|date)\b"
    r"|[.;]\s+[A-Z])",
    re.IGNORECASE,
)

# A subject shorter than this is a label, not a description.
MIN_SUBJECT_CHARS = 12
MAX_SUBJECT_CHARS = 300

# Only the opening of a document is searched for its subject line. Beyond this
# any match is part of the conditions of contract, not the subject.
SUBJECT_SEARCH_CHARS = 6_000

# Above this a document has a cover page, a confidentiality notice and pages of
# standard conditions, so its opening lines are not its subject.
LONG_DOCUMENT_CHARS = 4_000


@dataclass
class Subject:
    text: str
    # "stated"   the document labels this as its subject -- trust it
    # "opening"  taken from the opening lines -- an inference
    # "dominant" the vocabulary a long document repeats -- an inference
    # "none"     the document does not say what it is for
    source: str
    excerpt: str = ""

    @property
    def found(self) -> bool:
        return bool(self.text)

    @property
    def needs_confirmation(self) -> bool:
        return self.source != "stated"


def _tidy(value: str) -> str:
    value = " ".join(value.split())
    cut = _SUBJECT_END.search(value)
    if cut:
        value = value[: cut.start()]
    # Drop a leading procurement verb: "Procurement of X" describes X.
    value = _VERB_RE.sub(" ", value, count=1)
    # Strip surrounding punctuation only. \W would also take Indic combining
    # marks, which are not word characters to Python but are very much part of
    # the word: it turned "தலைக்கவசம்" into "தலைக்கவசம", quietly corrupting
    # the last letter of every Tamil, Hindi or Kannada subject line.
    value = value.strip(' \t\r\n:;,.-–—/\\|*#"\'()[]{}')
    return " ".join(value.split())[:MAX_SUBJECT_CHARS]


def extract_subject(text: str, vocabulary=None) -> Subject:
    """The tender's own statement of what it is for.

    `vocabulary` is the set of words the standards catalogue actually uses in
    its titles. It is supplied by the caller rather than known here, and only
    matters for the last resort: it is what separates "cement" from
    "contractor" in a document that repeats both.
    """
    if not text or not text.strip():
        return Subject("", "none")

    head = " ".join(text[:SUBJECT_SEARCH_CHARS].split())

    # 1. A labelled subject line. This is the strongest signal a tender gives.
    for match in _MARKER_RE.finditer(head):
        candidate = _tidy(head[match.end() : match.end() + 400])
        if len(candidate) >= MIN_SUBJECT_CHARS:
            return Subject(candidate, "stated", head[max(0, match.start() - 40) : match.end() + 200])

    # 2. No label, but a procurement verb near the top still names the goods.
    verb = _VERB_RE.search(head)
    if verb:
        candidate = _tidy(head[verb.start() : verb.start() + 400])
        if len(candidate) >= MIN_SUBJECT_CHARS:
            return Subject(candidate, "opening", head[verb.start() : verb.start() + 240])

    # 3. A short typed description is itself the subject -- there is no
    #    boilerplate to wade through.
    if len(text) < LONG_DOCUMENT_CHARS:
        opening = _tidy(head[:400])
        if len(opening) >= MIN_SUBJECT_CHARS:
            return Subject(opening, "opening", head[:240])
        return Subject("", "none")

    # 4. A long document with no subject line. Its opening is a cover page and
    #    a confidentiality notice, so reading that gives "Proprietary Notice and
    #    Version Control" instead of what is being bought. What the document
    #    actually concerns is what it returns to: the vocabulary it repeats.
    return _dominant_subject(text, vocabulary)


def _dominant_subject(text: str, vocabulary=None) -> Subject:
    """The technical vocabulary a long document keeps returning to.

    Frequency alone is not enough. A government tender repeats "contractor",
    "engineer" and "specification" far more than it repeats what it is buying,
    and those words describe every tender equally, so they identify none of
    them. Where the catalogue's own vocabulary is available, only words that
    appear in the titles of published standards are considered: "cement" is
    the title of many standards, "contractor" is the title of none.
    """
    counts = Counter(
        word
        for word in re.findall(r"[A-Za-zऀ-ൿ]{4,}", text.lower())
        if word not in STOP_WORDS
    )
    if not counts:
        return Subject("", "none")

    if vocabulary is not None:
        # Repetition alone favours the words every tender contains. Weighting
        # each by how rare it is across the catalogue's titles favours the
        # words that actually identify goods: a term naming fifty standards
        # says far more than one naming five hundred.
        scored = {
            word: count * vocabulary.weight(word)
            for word, count in counts.items()
            if count >= 3 and vocabulary.weight(word) > 0
        }
        if scored:
            ordered = sorted(scored, key=lambda w: scored[w], reverse=True)
            # Everything within half the best score. A long tender scores its
            # goods far above its paperwork, so this keeps the subject and
            # drops "contractor" and "specification" rather than listing them
            # underneath.
            cutoff = scored[ordered[0]] / 2
            chosen = [word for word in ordered if scored[word] >= cutoff][:8]
            excerpt = ", ".join(f"{w} ({counts[w]}x)" for w in chosen[:5])
            return Subject(" ".join(chosen), "dominant", f"distinctive repeated terms: {excerpt}")

    ranked = counts.most_common(40)
    floor = max(3, ranked[0][1] // 12)
    chosen = [word for word, n in ranked if n >= floor][:8]
    if not chosen:
        return Subject("", "none")

    excerpt = ", ".join(f"{word} ({counts[word]})" for word in chosen[:5])
    return Subject(" ".join(chosen), "dominant", f"most repeated terms: {excerpt}")
