# The analysis service. Runs on any container host with ~2 GB RAM.
#
# The language-model briefing is off by default here: no affordable container
# host runs a 7B model at usable speed. Retrieval, the knowledge graph, the
# scorecard, clause drafting, analytics and the deterministic document summary
# all work without it, and the interface already handles its absence.
FROM python:3.13-slim

# MANAKSETU_MODEL_CACHE keeps the embedding model inside the image, so a cold
# start does not re-download 225 MB.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENABLE_LLM_EXPLANATIONS=false \
    MANAKSETU_MODEL_CACHE=/app/.model-cache

# tesseract: OCR for scanned tender pages. libgl/libglib: pdfplumber's imaging path.
RUN apt-get update && apt-get install --no-install-recommends -y \
        tesseract-ocr \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Bake the embedding model in, so the first request does not pay a 225 MB
# download. Failure here is not fatal: the service degrades to lexical search.
RUN python -c "from app.services.embeddings import semantic_index; print('embedding model ready:', semantic_index.available)" || true

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
