"""Ingest policy documents into the RAG store.

    python -m scripts.ingest --namespace POL-431162 path/to/policy.md [more...]
    python -m scripts.ingest --namespace POL-1 --dry-run policy.txt   # just chunk

Pipeline: file -> parse -> structure-aware chunk -> embed -> store (pgvector when
NOLOOP_RAG_STORE=pgvector, else an ephemeral in-memory store for a dry run).

Rich formats (PDF/DOCX) are converted with docling/unstructured if installed;
plain text and Markdown need no extra deps.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.rag.chunk import chunk_document  # noqa: E402
from app.rag.config import get_rag_config  # noqa: E402
from app.rag.embeddings import get_embedder  # noqa: E402


def _read(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in (".txt", ".md", ".markdown"):
        return path.read_text(encoding="utf-8", errors="ignore")
    # Best-effort rich formats via optional converters.
    try:
        from docling.document_converter import DocumentConverter  # type: ignore

        return DocumentConverter().convert(str(path)).document.export_to_markdown()
    except Exception:
        pass
    try:
        from unstructured.partition.auto import partition  # type: ignore

        return "\n".join(str(el) for el in partition(filename=str(path)))
    except Exception as e:  # noqa: BLE001
        raise SystemExit(
            f"Cannot read {path}: install `docling` or `unstructured` for "
            f"{suffix} files, or convert to .md/.txt first ({e})"
        ) from e


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest policy docs into the RAG store.")
    ap.add_argument("files", nargs="+")
    ap.add_argument("--namespace", required=True, help="corpus scope, e.g. the policy number")
    ap.add_argument("--dry-run", action="store_true", help="chunk + embed only; do not persist")
    args = ap.parse_args()

    cfg = get_rag_config()
    embedder = get_embedder(cfg)

    all_chunks = []
    for f in args.files:
        path = Path(f)
        text = _read(path)
        chunks = chunk_document(
            text,
            doc_id=path.stem,
            max_chunk_chars=cfg.max_chunk_chars,
            overlap=cfg.chunk_overlap_chars,
            base_meta={"source": path.name},
        )
        all_chunks.extend(chunks)
        print(f"  {path.name}: {len(chunks)} chunks")

    print(f"\nTotal: {len(all_chunks)} chunks, embedder={embedder.name}, dim={embedder.dim}")

    if args.dry_run:
        for c in all_chunks[:5]:
            print(f"  [{c.ref}] {c.heading}: {c.text[:80]!r}")
        print("(dry run — nothing persisted)")
        return

    if cfg.store_backend == "pgvector":
        from app.rag.pgstore import PgVectorStore

        store = PgVectorStore()
        store.add(all_chunks, embedder, namespace=args.namespace)
        print(f"Upserted {len(all_chunks)} chunks into pgvector namespace {args.namespace!r}.")
    else:
        raise SystemExit(
            "NOLOOP_RAG_STORE is not 'pgvector'; nothing to persist. "
            "Use --dry-run, or set NOLOOP_RAG_STORE=pgvector + DATABASE_URL."
        )


if __name__ == "__main__":
    main()
