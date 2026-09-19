# Deploying ManakSetu

The dashboard deploys to Vercel. The analysis service does not, and cannot —
this document explains why, and gives the two working arrangements.

## Why the backend cannot go on Vercel

A Vercel serverless function is capped at 250 MB unzipped and a short
execution window. The analysis service needs:

| Component | Size / need | Serverless? |
|---|---|---|
| Ollama + `qwen2.5:7b` | 4.7 GB, resident between requests | No |
| `fastembed` embedding model | 225 MB ONNX, loaded into memory | No — the dependency tree alone exceeds the cap |
| Catalogue database | 2,914 records with stored vectors, written at startup | No — the filesystem is ephemeral |
| Tesseract OCR | native binary | No |

This is not a packaging problem to be worked around. The system's central
claim is that **no tender text ever leaves the machine it is processed on**,
which is why the model is local in the first place. Hosting the model in the
cloud would remove the property the project exists to demonstrate.

So: **the dashboard is public, the analysis service stays where the data is.**

---

## Step 1 — deploy the dashboard (both arrangements need this)

```bash
npx vercel login
npx vercel --prod
```

Accept the detected Next.js settings. The repository root is the project
root; `.vercelignore` keeps `backend/` out of the upload.

## Step 2 — point it at an analysis service

Set one environment variable in the Vercel project
(**Settings → Environment Variables**), then redeploy:

```
NEXT_PUBLIC_API_URL = https://<your-api-host>/api/v1
```

It must be `https` and must end in `/api/v1`. Browsers refuse a plain-`http`
request from an `https` page, so a bare `http://localhost:8000` will not work
from a deployed dashboard.

---

## Arrangement A — public dashboard, service on your machine (recommended)

Keeps every feature: the local model briefing, all 2,914 standards, OCR.
The launcher already publishes an HTTPS tunnel:

```bash
powershell -ExecutionPolicy Bypass -File start-demo.ps1 -Public -SkipWeb
```

It prints an API URL like `https://something-random.trycloudflare.com`. Put
that plus `/api/v1` into `NEXT_PUBLIC_API_URL` and redeploy. Anyone can now
open the Vercel URL from any device; the analysis runs on your hardware.

Trade-off: your machine must be running during the demonstration, and a free
Cloudflare quick tunnel gets a new address each restart.

## Arrangement B — always-on service on a container host

Render, Railway and Fly.io all run the `backend/Dockerfile`. Provision at
least **2 GB RAM** — the embedding model needs roughly 1 GB resident.

Set these on the host:

```
ENVIRONMENT=production
JWT_SECRET=<64 random characters>
DATABASE_URL=postgresql+psycopg://…        # a managed Postgres
CORS_ORIGINS=https://<your-project>.vercel.app
ENABLE_LLM_EXPLANATIONS=false
```

`ENABLE_LLM_EXPLANATIONS=false` is deliberate: no affordable container host
runs a 7B model at usable speed. Everything else still works — retrieval, the
knowledge graph, the scorecard, clause drafting, analytics, and the
deterministic *document at a glance* summary. Only the prose paragraph is
absent, and the interface already handles that case without complaint.

---

## What a visitor sees if the service is unreachable

The dashboard explains itself: a panel naming the address it tried and how to
start the service. It never shows a sign-in form that cannot succeed.
