"""Local semantic embeddings for standards retrieval.

Uses fastembed (ONNX runtime) rather than sentence-transformers so the
prototype stays free, local, and free of a PyTorch dependency. The model is
downloaded once into a local cache and then runs entirely offline on CPU.

Every entry point degrades safely: if the model cannot be loaded the index
reports ``available is False`` and the caller falls back to lexical-only
retrieval. Semantic similarity never invents a record -- it only reorders
candidates that already exist in the verified catalogue.
"""

from __future__ import annotations

import logging
import math
import os
from pathlib import Path
from threading import Lock

logger = logging.getLogger(__name__)

# Cache the ONNX weights beside the application rather than in the system temp
# directory, which Windows may clear between sessions and would force a
# re-download immediately before a demonstration.
MODEL_CACHE_DIR = Path(os.environ.get("MANAKSETU_MODEL_CACHE", Path(__file__).resolve().parents[2] / ".model-cache"))

# Preference order: a multilingual model lets a Hindi or Telugu query match an
# English catalogue title. The English-only model is a smaller fallback.
MODEL_PREFERENCES = (
    # 220 MB, 384 dimensions, covers Hindi and Telugu. Small enough to run on a
    # laptop CPU alongside the rest of the stack.
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "BAAI/bge-small-en-v1.5",
)


class SemanticIndex:
    """Lazily-loaded embedding model with a hard fallback to 'unavailable'."""

    def __init__(self) -> None:
        self._model = None
        self._model_name: str | None = None
        self._lock = Lock()
        self._attempted = False

    def _load(self) -> None:
        if self._attempted:
            return
        self._attempted = True
        try:
            from fastembed import TextEmbedding
        except ImportError:
            logger.warning("fastembed is not installed; semantic search disabled")
            return

        try:
            supported = {entry["model"] for entry in TextEmbedding.list_supported_models()}
        except Exception:  # pragma: no cover - defensive
            supported = set()

        for name in MODEL_PREFERENCES:
            if supported and name not in supported:
                continue
            try:
                MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
                self._model = TextEmbedding(model_name=name, cache_dir=str(MODEL_CACHE_DIR))
                self._model_name = name
                logger.info("Semantic index loaded model %s", name)
                return
            except Exception as exc:  # pragma: no cover - network/disk dependent
                logger.warning("Could not load embedding model %s: %s", name, exc)
        logger.warning("No embedding model could be loaded; semantic search disabled")

    @property
    def available(self) -> bool:
        with self._lock:
            self._load()
            return self._model is not None

    @property
    def model_name(self) -> str | None:
        with self._lock:
            self._load()
            return self._model_name

    def embed(self, texts: list[str]) -> list[list[float]] | None:
        """Return one embedding per input text, or None when unavailable."""
        if not texts:
            return []
        with self._lock:
            self._load()
            if self._model is None:
                return None
            try:
                return [vector.tolist() for vector in self._model.embed(texts)]
            except Exception as exc:  # pragma: no cover - runtime dependent
                logger.warning("Embedding failed: %s", exc)
                return None

    def embed_one(self, text: str) -> list[float] | None:
        result = self.embed([text])
        return result[0] if result else None


semantic_index = SemanticIndex()


def cosine_similarity(left: list[float] | None, right: list[float] | None) -> float:
    """Cosine similarity clamped to [0, 1]; 0.0 when either side is missing."""
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return max(0.0, min(1.0, dot / (left_norm * right_norm)))


def standard_document(official_title: str, scope_summary: str) -> str:
    """The text an individual standard is indexed under."""
    return f"{official_title}. {scope_summary}".strip()
