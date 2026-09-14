# ManakSetu AI

ManakSetu AI is an explainable, human-in-the-loop system for identifying applicable Indian Standards in public procurement. It retrieves candidates from controlled records, checks deterministic regulatory rules, exposes evidence status, and keeps the final decision with an authorised reviewer.

> Seed records carry an explicit `demo` or `verified` status. Demo records have no IS number or official source and must never be cited in a tender.

## Implemented MVP foundation

- Next.js 15, React 19, TypeScript and Tailwind CSS frontend
- Responsive analysis dashboard and live tender-submission workflow
- FastAPI and Pydantic API with OpenAPI documentation
- SQLAlchemy schema for users, categories, standards, QCOs, tenders, recommendations and audit logs
- PostgreSQL/pgvector Docker service with SQLite development fallback
- Keyword candidate ranking and tender-gap detection
- Deterministic QCO check that refuses mandatory claims from unverified records
- Source-traceable IS 2925:1984 public metadata and its 2023 helmet QCO from official BIS sources
- JWT/Argon2 authentication foundation
- Validated PDF, DOCX and TXT upload endpoint with size limits
- Text extraction for digital PDF, DOCX, XLSX and TXT tenders
- Scanned-document detection with a safe `ocr_required` handoff
- Human review decisions and queryable audit history
- Downloadable JSON, PDF, DOCX and XLSX recommendation reports
- Alembic migration foundation
- Optional Docker Compose profiles for Neo4j Community and Ollama
- Pytest guardrail tests

## Repository structure

```text
app/                    Next.js application
lib/api.ts              Typed frontend API client
backend/app/            FastAPI application and domain services
backend/alembic/        Database migrations
backend/tests/          Backend tests
compose.yaml            Local PostgreSQL, API and frontend stack
prompt.txt              Complete product source of truth
```

## Run with Docker Compose

Docker Desktop is the recommended full-stack path:

```bash
docker compose up --build
```

- Frontend: `http://localhost:3000`
- API: `http://localhost:8000`
- OpenAPI: `http://localhost:8000/docs`

Optional local services remain off by default to keep laptop requirements manageable:

```bash
docker compose --profile graph --profile ai up --build
```

## Run without Docker

Frontend:

```bash
pnpm install
pnpm dev
```

Backend on Windows PowerShell:

```powershell
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
Set-Location backend
.venv/Scripts/python.exe -m uvicorn app.main:app --reload
```

The backend defaults to a local SQLite file when `DATABASE_URL` is absent. Copy `backend/.env.example` to `backend/.env` and change its values to use PostgreSQL outside Docker.

## Verify

```bash
pnpm build
backend/.venv/Scripts/python.exe -m pytest backend
```

## Safety boundary

The local language model will be added only as an explanation and structured-extraction layer. It will never be allowed to invent standard numbers or decide certification status. A record must have verified metadata, an official source, and deterministic rule evidence before the API may present it as factual.

## Prototype boundaries

- Most seeded catalogue entries are demonstration records, not Indian Standards.
- The safety-helmet category includes one separately marked verified public-metadata record; its source URLs, content hash and check date are stored with the record.
- PaddleOCR, BGE-M3, Neo4j traversal and Ollama are integration-ready next-stage services; they are not silently simulated.
- Real BIS/QCO metadata must be imported only from permitted official sources and reviewed before its verification status is changed.
- Target quality metrics in `prompt.txt` remain targets until evaluated against an expert-labelled dataset.
