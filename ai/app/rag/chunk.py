"""Structure-aware chunking for policy documents.

Policy wordings are hierarchical (sections → clauses), and citations must point
at a *clause*, not a byte range. So we split on headings first, capture each
section's clause reference (its number, e.g. "3.2", or a slug of its title),
then pack the body into overlapping chunks that each inherit that clause ref.
This keeps citations meaningful (``citedClauseRefs = ["3.2"]``) and retrieval
focused.

Plain text / Markdown are handled here directly. Richer formats (PDF, DOCX) are
converted upstream in ingest.py via docling/unstructured when available.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# A heading is a markdown "#..", a numbered clause "3.2 Title", an all-caps
# short line, or an explicit "SECTION 4 - Title".
_MD_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.*\S)\s*$")
_NUM_HEADING = re.compile(r"^\s*((?:\d+\.)*\d+)[.)]?\s+(\S.*)$")
_SECTION_HEADING = re.compile(r"^\s*(SECTION|CLAUSE|ARTICLE)\s+([0-9IVXLC]+)\b[\s:–-]*(.*)$", re.I)


@dataclass
class Chunk:
    doc_id: str
    ref: str  # clause reference used for citation, e.g. "3.2" or "ROOM_RENT"
    heading: str
    text: str
    ordinal: int  # position within the document, for stable chunk ids
    meta: dict = field(default_factory=dict)

    @property
    def id(self) -> str:
        return f"{self.doc_id}#{self.ordinal}"


def _slug(title: str) -> str:
    words = re.sub(r"[^a-z0-9]+", " ", title.lower()).split()
    return "_".join(words[:4]).upper() or "GENERAL"


def _detect_heading(line: str) -> tuple[str, str] | None:
    """Return (clause_ref, title) if the line is a heading, else None."""
    m = _SECTION_HEADING.match(line)
    if m:
        title = (m.group(3) or "").strip()
        return m.group(2), title or f"{m.group(1).title()} {m.group(2)}"
    m = _NUM_HEADING.match(line)
    if m and len(m.group(2)) <= 80:
        return m.group(1), m.group(2).strip()
    m = _MD_HEADING.match(line)
    if m:
        title = m.group(1)
        return _slug(title), title
    stripped = line.strip()
    if 3 <= len(stripped) <= 60 and stripped.isupper() and any(c.isalpha() for c in stripped):
        return _slug(stripped), stripped.title()
    return None


def _pack(text: str, max_chars: int, overlap: int) -> list[str]:
    """Greedy sentence-ish packing into <= max_chars windows with overlap."""
    text = text.strip()
    if len(text) <= max_chars:
        return [text] if text else []
    # Split on sentence boundaries / newlines, then greedily fill windows.
    parts = re.split(r"(?<=[.;:])\s+|\n+", text)
    chunks: list[str] = []
    cur = ""
    for part in parts:
        if not part:
            continue
        if len(cur) + len(part) + 1 > max_chars and cur:
            chunks.append(cur.strip())
            # carry an overlap tail into the next window for context continuity
            cur = (cur[-overlap:] + " ") if overlap else ""
        cur += part + " "
    if cur.strip():
        chunks.append(cur.strip())
    return chunks


def chunk_document(
    text: str,
    doc_id: str,
    *,
    max_chunk_chars: int = 900,
    overlap: int = 120,
    base_meta: dict | None = None,
) -> list[Chunk]:
    """Split a document into clause-tagged, size-bounded chunks."""
    base_meta = base_meta or {}
    lines = text.splitlines()

    sections: list[tuple[str, str, list[str]]] = []  # (ref, heading, body-lines)
    cur_ref, cur_heading, body = "PREAMBLE", "Preamble", []
    for line in lines:
        head = _detect_heading(line)
        if head:
            if body:
                sections.append((cur_ref, cur_heading, body))
            cur_ref, cur_heading = head
            body = []
        else:
            body.append(line)
    if body:
        sections.append((cur_ref, cur_heading, body))

    chunks: list[Chunk] = []
    ordinal = 0
    for ref, heading, body_lines in sections:
        body_text = "\n".join(body_lines).strip()
        # Keep the heading inside the chunk text so lexical + semantic search
        # can match on the clause title too.
        packed = _pack(body_text, max_chunk_chars, overlap) or [""]
        for piece in packed:
            if not piece and heading in ("Preamble", ""):
                continue
            full = f"{heading}\n{piece}".strip() if heading else piece
            chunks.append(
                Chunk(
                    doc_id=doc_id,
                    ref=ref,
                    heading=heading,
                    text=full,
                    ordinal=ordinal,
                    meta=dict(base_meta),
                )
            )
            ordinal += 1
    return chunks
