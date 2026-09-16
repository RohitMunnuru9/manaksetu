# ManakSetu AI

ManakSetu AI is an explainable, human-in-the-loop system for identifying applicable Indian Standards in public procurement. It retrieves candidates from controlled records, checks deterministic regulatory rules, exposes evidence status, and keeps the final decision with an authorised reviewer.

> Every record carries an explicit tier: **verified** (checked by a person against
> the official BIS entry), **pending** (imported from an official BIS page, real
> identifier shown, not yet confirmed), or **demo** (illustrative, carries no
> identifier at all). Only a verified record should be cited in a tender.

## Demonstration script

Eight cases, in order. Sign in with the local judge credentials below, then use
**New analysis** for each. Every claim here is reproducible from a clean database.

| # | Paste this as the description | What to point out |
|---|---|---|
| 1 | `Purchase 1,000 industrial safety helmet units for construction workers with impact testing and permanent marking.` | IS 2925:1984 returned as **primary**, marked `verified`, with a live BIS source link and a **mandatory certification** flag raised by the 2023 helmet QCO. |
| 2 | `Procurement of head protection gear for labourers working at elevated building sites.` | The same standard is still ranked first **although the word "helmet" never appears**. The reason line shows the embedding similarity. This is the difference between this system and keyword search. |
| 3 | `औद्योगिक सुरक्षा हेलमेट निर्माण श्रमिकों के लिए खरीद` | A Hindi query retrieves the English-titled standard. Language is detected as `hi`; the embedding model is multilingual. |
| 4 | `Supply of bottled water for office consumption with microbiological testing.` | Retrieval switches cleanly to the water category. No helmet records leak in. |
| 5 | `Procurement of artisanal sourdough starter cultures for the canteen.` | Returns **zero** recommendations and the guardrail message *"No verified recommendation found. Expert review is required."* The system declines rather than guessing. |
| 6 | Same as case 1 — look at the **supporting cards** | One card is flagged **Outdated record** (withdrawn, superseded by IS 2925:1984); another shows **Amended since publication** with both amendments listed. Currency is decided deterministically, never by the model. |
| 7 | Upload a **scanned** PDF (an image-only page, no text layer) | Tesseract reads it locally and the tender is analysed normally. Without Tesseract installed the document is flagged `ocr_required` rather than silently returning empty text. |
| 8 | Sign in as `supplier@example.in` | Review, export and audit controls disappear, and calling those endpoints directly returns **403**. Access control is enforced by the API, not by hiding buttons. |

### Real BIS data in the catalogue

Fifteen real Indian Standards were imported from official BIS pages on
2026-09-16, across four categories. Try any of these and the top result is a real
IS number:

| Tender description | Top result |
|---|---|
| `Supply of 500 tonnes ordinary portland cement for structural concrete works.` | **IS 269** — Ordinary Portland Cement |
| `Procurement of PVC insulated power cables for building wiring up to 1100 V.` | **IS 694** — PVC insulated cables for working voltages up to and including 1100V |
| `Supply of packaged drinking water bottles for office consumption.` | **IS 14543:2016** — Packaged Drinking Water |
| `Purchase of safety footwear with protective toecap for factory workers.` | **IS 15298 (Part 2)** — Personal Protective Equipment Safety Footwear |

These are shown as **Imported · awaiting check** rather than verified. The number
came off an official BIS page, so it is real and is displayed — but no officer has
confirmed the title and year against the BIS catalogue entry, and the interface
says so. Promoting one to verified means opening its source, checking it, setting
`last_checked_date` in `backend/app/data/catalogue.json`, and re-seeding. The
seeder refuses to promote a record without that date.

Only **IS 2925:1984** is officer-verified, and it is the only record that raises a
mandatory-certification finding, because the rule engine will not assert a legal
obligation from an unconfirmed record.

### The strongest thing to show a reviewer

Ask the same local model the same question with no guardrail:

```bash
ollama run qwen2.5:7b "List four Indian Standard (IS) numbers relevant to industrial safety helmets."
```

It answers confidently and wrongly. In one run it produced IS 10500:2010,
IS 10501:2010, IS 10502:2010 and IS 10503:2010, all titled as helmet standards --
IS 10500 is in fact the specification for drinking water. Every one of those four
is rejected by this system's validator, because none appears in the retrieved
evidence. That contrast is the entire argument for the project.

In cases 1-3, the supporting cards carry a **graph link** badge (`tested_by of IS
2925:1984`) showing the allied standard was included because of a modelled
relationship, not because of tender wording.

### The claim to make to a reviewer

Every IS number shown comes from a catalogue record with an official source URL,
and the interface always says which tier that record is in. A demonstration record
carries no identifier at all. An imported record shows its real identifier and
states that no officer has confirmed it. Only an officer-verified record carries a
content hash and a check date, and only such a record can raise a mandatory
certification finding.

Nothing below the verified tier can present as high confidence: the ranking caps
it. And no language model generates a standard identifier anywhere in this system
-- the briefing layer may only quote identifiers that retrieval already returned,
and any output containing one it did not is discarded.

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
- JWT/Argon2 authentication with a signing secret that has no committed default:
  development mints an ephemeral one, other environments refuse to start without a real one
- Role-based access control over a named capability matrix (six roles, six
  permissions), enforced per endpoint by the API and fail-closed for any
  unrecognised role; the interface hides what the role cannot do, and the server
  refuses it independently
- Validated PDF, DOCX and TXT upload endpoint with size limits
- Text extraction for digital PDF, DOCX, XLSX and TXT tenders
- PDF table extraction with pdfplumber

- Deterministic Hindi/Telugu/English detection and structured requirement extraction
- Scanned-document detection with a safe `ocr_required` handoff
- Human review decisions and queryable audit history
- Downloadable JSON, PDF, DOCX and XLSX recommendation reports
- Optional local Qwen briefing layer via Ollama, constrained to retrieved
  evidence and validated afterwards: output citing a standard that was not
  retrieved, or asserting a certification the rule engine did not confirm, is
  discarded rather than shown
- Deterministic version checking: withdrawn and revised records are flagged with
  their replacement, amendments are listed against the record they amend, and a
  standard number cited in the tender itself is checked against the catalogue
- Local Tesseract OCR resolved by path rather than by shell environment, so a
  freshly installed engine works without restarting anything
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

## Run the demonstration

One command, from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File start-demo.ps1
```

It clears anything holding ports 3000 and 8000, generates a signing secret if
`backend/.env` is missing, starts Ollama if it is installed, then brings up the
API and the dashboard and waits until each one actually answers before reporting
success. Add `-Fresh` to rebuild the `.next` cache and reseed the database, or
`-SkipModel` to run without the briefing layer.

Every failure encountered while building this was operational rather than logical
-- a killed dev server leaving a listener on port 3000 so Next quietly started on
3001 and the browser kept showing a stale build, a production build run alongside
the dev server corrupting `.next`, Ollama not running. The script exists to make
those impossible before a demonstration.

## Run with Docker Compose

Docker Desktop is the recommended full-stack path:

```bash
docker compose up --build
```

- Frontend: `http://localhost:3000`
- API: `http://localhost:8000`
- OpenAPI: `http://localhost:8000/docs`

### Local judge login

Two demonstration accounts are seeded, both with password `ManakSetu@2026`:

| Email | Role | Can do |
|---|---|---|
| `officer@manaksetu.gov.in` | Procurement officer | Submit tenders, review, export reports, read the audit trail |
| `supplier@example.in` | Supplier | Read the standards catalogue only |

Signing in as the supplier is the quickest way to show access control working: the
review, export and audit-history controls disappear, and calling those endpoints
directly returns **403** rather than relying on the interface to hide them.

These accounts exist only where `SEED_DEMO_USERS=true`. Set it to `false` for any
shared deployment.

### Signing secret

`JWT_SECRET` has no default and no usable value is committed anywhere.

- **Development** — leave it unset. The API generates a random secret at startup
  and logs a warning. Sessions end when the process restarts, which is correct
  for a laptop and means no secret lives in the repository.
- **Anything else** — set `ENVIRONMENT` to something other than `development` and
  supply a real `JWT_SECRET` of at least 32 characters. The API refuses to start
  if it is missing, too short, or set to any placeholder that has appeared in a
  committed file. Generate one with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

**To keep sessions alive across API restarts on a development machine**, write a
fixed secret into `backend/.env`, which is gitignored:

```bash
python -c "import secrets; print('JWT_SECRET=' + secrets.token_urlsafe(48))" > backend/.env
```

Each developer generates their own. Never commit the file, and never share the
value; anyone holding it can mint a token for any account. With no `backend/.env`
present the API falls back to the ephemeral secret, and every restart signs
everyone out.

### Optional: local language-model briefing

A local Qwen model can write a plain-English briefing over the retrieved
evidence. It is **off by default** and the system is fully functional without it.

```bash
winget install Ollama.Ollama       # installs and starts the service
ollama pull qwen2.5:7b             # 4.7 GB; qwen2.5:3b is ~2 GB on a smaller machine
```

It is **on by default** once the model is present. Set `ENABLE_LLM_EXPLANATIONS=false`
to skip it entirely.

**Timings on a 16 GB laptop, CPU only.** The analysis itself returns in about
3-7 seconds. The briefing is generated by a *separate* request that the dashboard
makes once results are already on screen, and takes roughly 30-50 seconds. This
split is deliberate: an officer sees evidence immediately, and a slow or absent
model can never delay it. The API warms the model in a background thread at
startup and keeps it resident for 30 minutes, so the first briefing does not pay
a 45-second cold load.

The model never decides anything. It receives only records retrieval already
produced, and its output is parsed afterwards: **any standard identifier that was
not in that evidence causes the entire explanation to be discarded**, and so does
a certification claim the deterministic rule engine did not make. The dashboard
says so out loud when it happens, rather than silently hiding it.

That ordering is the point. A prompt telling a model not to invent an IS number
is a request. Discarding output that contains one is a guarantee — and it is what
`backend/tests/test_explanation.py` asserts, without needing Ollama to run.

If Ollama is missing, slow or broken, the analysis completes exactly as before,
without prose.

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
- PaddleOCR is **not implemented**; Tesseract is used where the executable exists.
- The Ollama/Qwen layer writes prose only, and only when explicitly enabled. The
  per-recommendation reason text remains deterministic and is never produced by a
  language model. No language model generates a standard identifier anywhere in
  this system, and output that contains an unretrieved one is discarded.
- Version, amendment and supersession checking is implemented and deterministic.
  The **data** is demonstration data: the superseded record and its amendments are
  demo records, because no supersession or amendment has been verified against an
  official BIS source. No amendment is claimed against IS 2925:1984. Importing real
  revision history is a data task; the mechanism and its tests already exist.
- Alembic still creates the schema with `create_all` rather than versioned
  migrations, so a model change currently requires recreating the database.
  Fine for the prototype, not for anything holding real data.
- Ranking weights in `services/recommendation.py` are untuned starting values.
- This machine currently has no Tesseract executable, so scanned files are safely marked `ocr_required`; digital-document extraction remains fully operational.
- Real BIS/QCO metadata must be imported only from permitted official sources and reviewed before its verification status is changed.
- Target quality metrics in `prompt.txt` remain targets until evaluated against an expert-labelled dataset.
