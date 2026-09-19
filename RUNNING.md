# Running ManakSetu locally

Everything runs on your own machine. No API keys, no cloud account, no paid
service — the language model and the embedding model both run locally, which is
the point of the project rather than a limitation of it.

---

## 1. What you need

| Requirement | Version used here | Needed for | If missing |
|---|---|---|---|
| **Python** | 3.13.9 | The analysis API | Required |
| **Node.js** | 22.20.0 | The dashboard | Required |
| **Ollama** + `qwen2.5:7b` | 4.7 GB model | The written briefing | Everything else still works; the briefing panel says it is unavailable |
| **Tesseract OCR** | 5.4.0 | Reading scanned and photographed pages | Digital PDFs still work; scans are reported as unread rather than silently empty |

Python and Node are the only hard requirements. The other two degrade
honestly — the interface tells you what it could not do instead of pretending.

### Installing the optional two (Windows)

```powershell
winget install Ollama.Ollama
```
```powershell
winget install UB-Mannheim.TesseractOCR
```

Then pull the model once (4.7 GB, one-time):

```powershell
ollama pull qwen2.5:7b
```

> A shell opened **before** these installs keeps a stale copy of PATH, so
> `tesseract` may look missing even after a successful install. The application
> checks the usual install locations itself, so it will find it anyway — but if
> you want it on your own command line, open a new terminal.

---

## 2. First-time setup

From the repository root.

**Backend** — create the virtual environment and install dependencies:

```powershell
python -m venv backend/.venv
```
```powershell
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
```

**Frontend** — install packages:

```powershell
npm install
```

That is all. There is no database to create and no migration to run: the API
creates its SQLite file, seeds the curated catalogue, and imports the 2,880
harvested BIS standards on first start. The harvest file is committed to the
repository, so nothing is downloaded from BIS at runtime.

The embedding model (225 MB) downloads once on first analysis and is cached in
`backend/.model-cache`.

---

## 3. Running it

One command, from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File start-demo.ps1
```

This clears anything holding ports 3000 and 8000, generates a signing secret if
`backend/.env` is missing, starts Ollama if installed, then brings up the API
and the dashboard and waits until **each one actually answers** before saying it
is ready.

| | |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:8000 |
| API documentation | http://localhost:8000/docs |

**First start takes longer than later ones.** The embedding model downloads, and
2,880 standards are embedded and stored — a few minutes. Every start after that
is seconds.

### Useful flags

| Flag | What it does |
|---|---|
| `-Fresh` | Rebuild the `.next` cache and reseed the database from scratch |
| `-SkipModel` | Run without the language model, if Ollama is not installed |
| `-SkipWeb` | Start only the API, leaving port 3000 to something else |

---

## 4. Signing in

Sign-in is automatic — the dashboard opens straight into the officer's
workspace. Both demonstration accounts use the password `ManakSetu@2026`:

| Account | Role | Purpose |
|---|---|---|
| `officer@manaksetu.gov.in` | Procurement officer | Full access |
| `supplier@example.in` | Supplier | Restricted — review, export and audit are refused by the API, not merely hidden |

The profile chip in the top right switches between them.

---

## 5. Making it public

To show it on someone else's device, publish the dashboard through a tunnel.
Only port 3000 is tunnelled: the API is reached through it, because
`next.config.mjs` proxies `/api/*` to the analysis service. One address, no
CORS, nothing to reconfigure.

```powershell
powershell -ExecutionPolicy Bypass -File go-public.ps1
```

It prints an `https://….trycloudflare.com` address and then supervises it,
rebuilding the tunnel if the network drops without touching the API, the
dashboard or the model.

A free Cloudflare quick tunnel **cannot keep its address** across a rebuild. If
you need a link that never changes, claim a free static domain at
`dashboard.ngrok.com/domains` and use it:

```powershell
powershell -ExecutionPolicy Bypass -File go-public.ps1 -Ngrok yourname.ngrok-free.dev
```

---

## 6. Checking it works

```powershell
backend/.venv/Scripts/python.exe -m pytest backend
```

79 tests. To check the production build without disturbing a running dev
server, build into a separate directory:

```powershell
$env:MANAKSETU_DIST_DIR=".next-verify"; npm run build
```

> Never run `npm run build` while the dev server is running against the same
> directory. It corrupts `.next` and the running site starts returning 500s
> until you clear it and restart. That is what `MANAKSETU_DIST_DIR` is for.

---

## 7. When something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| "The analysis service is not running" | The API is not up | Run `start-demo.ps1`; the panel names the address it tried |
| Dashboard loads on port 3001 | A zombie process still holds 3000 | `start-demo.ps1` clears it; that is why it exists |
| Briefing says "not available" | Ollama is not running, or the model is not pulled | `ollama pull qwen2.5:7b`; results never depend on it |
| Briefing takes ~40 seconds | The model paged out after 30 idle minutes | Run one throwaway analysis a few minutes before you present |
| Scanned PDF reads as empty | Tesseract is not installed | Install it; the note on the analysis says so explicitly |
| Every site returns 500 after a build | `.next` was corrupted by building over the dev server | Stop the dev server, delete `.next`, start again |

---

## 8. Refreshing the BIS catalogue

The committed harvest was taken from the official BIS catalogue service. To
take a fresh one — 215 sectors, a few minutes, polite by default:

```powershell
backend/.venv/Scripts/python.exe backend/scripts/harvest_bis.py
```

It writes `backend/app/data/bis_harvest.json`. Restart the API and any records
not already present are imported, embedded, and enter as tier **pending** — a
real identifier from the official source that no officer has yet confirmed.
Nothing is ever invented, and a record without an identifier is never given one.
