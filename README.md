# ManakSetu AI

ManakSetu AI is an explainable, human-in-the-loop system for identifying applicable Indian Standards in public procurement. It retrieves candidates from controlled records, checks deterministic regulatory rules, exposes evidence status, and keeps the final decision with an authorised reviewer.

> Seed records carry an explicit `demo` or `verified` status. Demo records have no IS number or official source and must never be cited in a tender.

## Demonstration script

Five cases, in order. Sign in with the local judge credentials below, then use
**New analysis** for each. Every claim here is reproducible from a clean database.

| # | Paste this as the description | What to point out |
|---|---|---|
| 1 | `Purchase 1,000 industrial safety helmet units for construction workers with impact testing and permanent marking.` | IS 2925:1984 returned as **primary**, marked `verified`, with a live BIS source link and a **mandatory certification** flag raised by the 2023 helmet QCO. |
| 2 | `Procurement of head protection gear for labourers working at elevated building sites.` | The same standard is still ranked first **although the word "helmet" never appears**. The reason line shows the embedding similarity. This is the difference between this system and keyword search. |
| 3 | `औद्योगिक सुरक्षा हेलमेट निर्माण श्रमिकों के लिए खरीद` | A Hindi query retrieves the English-titled standard. Language is detected as `hi`; the embedding model is multilingual. |
| 4 | `Supply of bottled water for office consumption with microbiological testing.` | Retrieval switches cleanly to the water category. No helmet records leak in. |
| 5 | `Procurement of artisanal sourdough starter cultures for the canteen.` | Returns **zero** recommendations and the guardrail message *"No verified recommendation found. Expert review is required."* The system declines rather than guessing. |

In cases 1-3, the supporting cards carry a **graph link** badge (`tested_by of IS
2925:1984`) showing the allied standard was included because of a modelled
relationship, not because of tender wording.

### The claim to make to a reviewer

Every IS number shown comes from a verified catalogue record with an official
source URL, a content hash and a check date. Unverified records are rendered
without any IS number at all and are score-capped so they can never present as
high confidence. No language model generates standard identifiers anywhere in
this system.

## Implemented MVP foundation

- Next.js 15, React 19, TypeScript and Tailwind CSS frontend
- Responsive analysis dashboard and live tender-submission workflow
- FastAPI and Pydantic API with OpenAPI documentation
- SQLAlchemy schema for users, categories, standards, QCOs, tenders, recommendations and audit logs
- PostgreSQL/pgvector Docker service with SQLite development fallback
- Hybrid retrieval: PostgreSQL/SQLite keyword matching unioned with local
  semantic embeddings (fastembed / ONNX, `paraphrase-multilingual-MiniLM-L12-v2`,
  220 MB, CPU-only, no PyTorch and no external API)
- Cross-lingual retrieval: a Hindi or Telugu query matches an English catalogue title
- Standards knowledge graph as PostgreSQL relationship edges with one-hop
  traversal, so allied standards are justified by a modelled relationship rather
  than by rank position
- Controlled catalogue in `backend/app/data/catalogue.json`, editable without
  touching code; seeding refuses to promote a record to `verified` unless the IS
  number, official title, source URL, source organisation and check date are all present
- Tender-gap detection
- Deterministic QCO check that refuses mandatory claims from unverified records
- Source-traceable IS 2925:1984 public metadata and its 2023 helmet QCO from official BIS sources
- JWT/Argon2 authentication foundation
- Protected JWT workspace with role-gated review, audit and report actions
- Validated PDF, DOCX and TXT upload endpoint with size limits
- Text extraction for digital PDF, DOCX, XLSX and TXT tenders
- PDF table extraction with pdfplumber
- Local Tesseract OCR adapter for scanned PDFs, PNG and JPEG files when the executable is installed
- Deterministic Hindi/Telugu/English detection and structured requirement extraction
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

### Local judge login

- Email: `officer@manaksetu.gov.in`
- Password: `ManakSetu@2026`

These credentials are for the local demonstration environment only. Override `DEMO_USER_EMAIL`, `DEMO_USER_PASSWORD`, and `JWT_SECRET` before any shared deployment.

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
- Semantic retrieval runs on fastembed rather than BGE-M3, and the knowledge
  graph runs on PostgreSQL relationship edges rather than Neo4j. Both are the
  laptop-scale options the specification permits; neither is simulated.
- PaddleOCR and the Ollama/Qwen explanation layer are **not implemented**. The
  reason text shown for each recommendation is generated deterministically from
  retrieval evidence, not by a language model.
- Version, amendment and withdrawal checking is **not implemented**; the schema
  carries status fields but there is no revision-history table yet.
- Ranking weights in `services/recommendation.py` are untuned starting values.
- This machine currently has no Tesseract executable, so scanned files are safely marked `ocr_required`; digital-document extraction remains fully operational.
- Real BIS/QCO metadata must be imported only from permitted official sources and reviewed before its verification status is changed.
- Target quality metrics in `prompt.txt` remain targets until evaluated against an expert-labelled dataset.
