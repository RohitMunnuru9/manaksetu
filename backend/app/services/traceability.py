"""Clause-level traceability: which sentences of the tender drove a match.

Every recommendation carries retrieval evidence (matched terms). This module
turns that into something an officer can check in one glance: the exact
passages of their own tender that contain those terms, with character offsets
so the interface can highlight them in place.

Deliberately deterministic. The spans are found by string matching against the
stored tender text, so a highlighted sentence is always genuinely present in
the document -- this feature must never paraphrase, summarise or reconstruct.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# A "sentence" here is a display unit, not a linguistic claim: tender documents
# are full of clause numbers, tables and abbreviations, so splitting is kept
# conservative and spans are capped rather than perfected.
_SENTENCE_BREAK = re.compile(r"(?<=[.!?;])\s+|\n{2,}")
MAX_SPANS = 4
MAX_SPAN_CHARS = 320


@dataclass
class EvidenceSpan:
    text: str
    start: int
    end: int
    terms: list[str] = field(default_factory=list)


def split_passages(text: str) -> list[tuple[int, int]]:
    """(start, end) offsets of display passages, in document order."""
    spans: list[tuple[int, int]] = []
    cursor = 0
    for match in _SENTENCE_BREAK.finditer(text):
        if match.start() > cursor:
            spans.append((cursor, match.start()))
        cursor = match.end()
    if cursor < len(text):
        spans.append((cursor, len(text)))
    return spans


def evidence_spans(text: str, terms: list[str], limit: int = MAX_SPANS) -> list[EvidenceSpan]:
    """The passages of `text` that contain the most matched terms.

    Ranked by how many distinct terms a passage contains, then by document
    order, so the strongest evidence is listed first but ties read naturally.
    """
    if not text or not terms:
        return []
    lowered_terms = [term.lower() for term in terms if term.strip()]
    scored: list[tuple[int, int, EvidenceSpan]] = []
    for start, end in split_passages(text):
        passage = text[start:end]
        lowered = passage.lower()
        found = [term for term in lowered_terms if term in lowered]
        if not found:
            continue
        clipped = passage.strip()
        if len(clipped) > MAX_SPAN_CHARS:
            clipped = clipped[:MAX_SPAN_CHARS].rsplit(" ", 1)[0] + "…"
        scored.append((len(found), -start, EvidenceSpan(text=clipped, start=start, end=end, terms=sorted(set(found)))))
    scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
    top = [row[2] for row in scored[:limit]]
    top.sort(key=lambda span: span.start)
    return top
