# Track 3: Call Center Compliance

This repository implements the Track 3 hackathon requirement: a protected API that accepts one Base64-encoded MP3 call at a time, performs multi-stage AI analysis, and returns structured JSON for compliance and business intelligence.

The current solution includes:
- FastAPI backend for the required API
- AssemblyAI-based speech-to-text pipeline
- AssemblyAI-first transcript/translation flow with Groq-powered structured analysis
- SQLite-backed vector storage for transcript indexing and semantic search
- Next.js frontend for demoing uploads, analysis, transcript review, and PDF/CSV export

## Problem Statement Mapping

The PDF requires an API that:
- accepts one MP3 audio file at a time through Base64
- is protected by `x-api-key`
- performs transcription, NLP analysis, and metric extraction
- returns structured JSON with transcript, summary, SOP validation, analytics, and keywords
- shows evidence of vector indexing and semantic retrieval

This repository covers those requirements with:
- `POST /api/call-analytics`
- `POST /api/call-analytics/verbose`
- `GET /api/transcripts/search`

## Tech Stack

- Backend: FastAPI, Pydantic
- STT: AssemblyAI
- LLM: Groq `llama-3.3-70b-versatile`
- Vector storage: local SQLite-backed transcript index
- Frontend: Next.js + React

## Required API

### `POST /api/call-analytics`

Headers:

```http
Content-Type: application/json
x-api-key: sk_track3_987654321
```

Request body:

```json
{
  "language": "Tamil",
  "audioFormat": "mp3",
  "audioBase64": "<base64-encoded MP3>"
}
```

Success response shape:

```json
{
  "status": "success",
  "language": "Tamil",
  "transcript": "Agent: ...\nCustomer: ...",
  "summary": "Concise English summary of the conversation.",
  "sop_validation": {
    "greeting": true,
    "identification": false,
    "problemStatement": true,
    "solutionOffering": true,
    "closing": true,
    "complianceScore": 0.8,
    "adherenceStatus": "NOT_FOLLOWED",
    "explanation": "The agent did not identify the customer."
  },
  "analytics": {
    "paymentPreference": "EMI",
    "rejectionReason": "NONE",
    "sentiment": "Positive"
  },
  "keywords": [
    "EMI options",
    "resume",
    "placement support"
  ]
}
```

Notes:
- `language` is restricted to `Tamil` or `Hindi`
- `audioFormat` is restricted to `mp3`
- invalid API keys return `401 Unauthorized`
- invalid payloads return `422`

## Extended API For Demo / Review

### `POST /api/call-analytics/verbose`

Returns the same structure as `/api/call-analytics` plus:
- `original_transcript`
- `speaker_stats`

This endpoint is used by the frontend to show:
- original-language transcript
- cleaner `Agent:` / `Customer:` speaker turns
- speaker ratio stats

### `GET /api/transcripts/search`

Protected semantic search endpoint for indexed transcripts.

Example:

```powershell
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:8000/api/transcripts/search?query=emi&limit=3" `
  -Headers @{ "x-api-key" = "sk_track3_987654321" }
```

## Analysis Pipeline

### 1. Transcription

The backend:
- decodes the Base64 MP3
- uploads audio to AssemblyAI
- polls until transcription completes

### 2. Translation / Cleanup

The backend:
- uses `TRANSLATION_PROVIDER` to choose translation mode
- defaults to `assemblyai` mode (requests English translation via AssemblyAI `speech_understanding.translation`)
- supports optional `groq` mode for explicit LLM translation when needed
- keeps `original_transcript` in source language and returns English in `transcript`
- applies cleanup/guardrails for repetition artifacts and truncated translation payloads
- normalizes speaker labels into `Agent:` / `Customer:` where possible

### 3. Structured NLP Analysis

Groq extracts:
- summary
- SOP validation
- payment preference
- rejection reason
- sentiment
- keywords

### 4. Server-side Validation

The backend recomputes:
- `complianceScore`
- `adherenceStatus`

This avoids relying only on raw LLM output for those critical fields.

### 5. Vector Indexing

Every processed transcript is stored in the local vector index to demonstrate semantic retrieval, as required in the evaluation criteria.

## Classification Rules

- SOP flow: `Greeting -> Identification -> Problem Statement -> Solution Offering -> Closing`
- `complianceScore = true_steps / 5.0`
- `adherenceStatus = FOLLOWED` only when all five SOP stages are present
- payment preference is normalized to:
  - `EMI`
  - `FULL_PAYMENT`
  - `PARTIAL_PAYMENT`
  - `DOWN_PAYMENT`
  - `NONE`
- rejection reason is normalized to:
  - `HIGH_INTEREST`
  - `BUDGET_CONSTRAINTS`
  - `ALREADY_PAID`
  - `NOT_INTERESTED`
  - `NONE`

## Project Structure

```text
hcl_hackathon/
|- main.py
|- vector_store.py
|- README.md
|- requirements.txt
|- .env.example
|- render.yaml
|- frontend/
|  |- components/
|  |- pages/
|  |- styles/
|  |- package.json
|  `- vercel.json
`- data/
   `- transcripts.db   # created at runtime
```

## Local Setup

### Backend

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Set these environment variables in `.env`:

```env
GROQ_API_KEY=your_groq_api_key
ASSEMBLYAI_API_KEY=your_assemblyai_api_key
API_SECRET_KEY=sk_track3_987654321
STT_PROVIDER=assemblyai
TRANSLATION_PROVIDER=assemblyai
VECTOR_DB_PATH=data/transcripts.db
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_KEY=your_frontend_api_key
```

Run the backend:

```powershell
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

For local development, create `frontend/.env.local` and set:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_API_KEY=sk_track3_987654321
```

The frontend now reads the API key from `NEXT_PUBLIC_API_KEY` only (no API key input in the UI).

Note: use standard dotenv formatting (`KEY=value`) with no spaces around `=`.

Frontend URL:

```text
http://localhost:3000
```

Backend URL:

```text
http://localhost:8000
```

## Deployment Guide

Recommended setup:
- Backend on Render
- Frontend on Vercel

### 1. Prepare the repository

- Push the project to GitHub
- Make sure `.env` is not committed
- Keep `.env.example` as the template for required variables

### 2. Deploy the FastAPI backend on Render

Create a new Render Web Service pointing at this repository.

This repository now includes `render.yaml`, so you can also use Render Blueprint deployment instead of entering settings manually.

Settings:
- Environment: `Python`
- Root directory: repository root
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`

Add these Render environment variables:

```env
PYTHON_VERSION=3.11.10
GROQ_API_KEY=your_real_groq_key
ASSEMBLYAI_API_KEY=your_real_assemblyai_key
API_SECRET_KEY=your_api_secret_key
STT_PROVIDER=assemblyai
TRANSLATION_PROVIDER=assemblyai
VECTOR_DB_PATH=data/transcripts.db
```

This repo also includes `.python-version` and `render.yaml` pinned to Python `3.11.10` so Render does not default to Python `3.14.3`, which can break `pydantic-core` wheel installation for this dependency set.

After deployment, copy the Render backend URL, for example:

```text
https://your-backend-name.onrender.com
```

Verify the backend:
- Open `https://your-backend-name.onrender.com/health`
- Confirm it returns a healthy JSON response

### 3. Deploy the Next.js frontend on Vercel

Create a new Vercel project from the same repository.

This repository now includes `frontend/vercel.json`, so the frontend build commands are already captured in the repo.

Settings:
- Framework: `Next.js`
- Root directory: `frontend`

Add this Vercel environment variable:

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend-name.onrender.com
NEXT_PUBLIC_API_KEY=your_api_secret_key
```

This frontend now reads backend URL and browser-side API key from environment variables, so there is no URL hardcoding and no API key entry field in the UI.

### Deployment-ready checklist

1. Backend (Render) has these env vars configured:
  - `GROQ_API_KEY`
  - `ASSEMBLYAI_API_KEY`
  - `API_SECRET_KEY`
  - `STT_PROVIDER=assemblyai`
  - `TRANSLATION_PROVIDER=assemblyai`
  - `VECTOR_DB_PATH=data/transcripts.db`
2. Frontend (Vercel) has:
  - `NEXT_PUBLIC_API_BASE_URL=https://your-backend-name.onrender.com`
  - `NEXT_PUBLIC_API_KEY=<same API secret used by backend>`
3. Verify backend health endpoint before frontend tests:
  - `https://your-backend-name.onrender.com/health`
4. Verify required API endpoint:
  - `POST https://your-backend-name.onrender.com/api/call-analytics`

### 4. Redeploy and test the full flow

Deploy the backend first, then the frontend.

Test this flow:
1. Open the Vercel frontend URL
2. Click `Get started`
3. Click `Check platform status`
4. Upload an MP3 call
5. Run `Analyze conversation`
6. Confirm transcript, summary, SOP checks, analytics, and report downloads work

### 5. CORS and API key notes

- The backend must remain reachable from the Vercel frontend domain
- The app currently sends `x-api-key` from the browser for the hackathon flow
- For a real production deployment, move API-key handling behind a server-side proxy instead of shipping a usable key to the browser

### 6. Useful production URLs

- Backend health: `https://your-backend-name.onrender.com/health`
- Frontend app: `https://your-project-name.vercel.app`

## Manual API Test

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8000/api/call-analytics `
  -Headers @{ "x-api-key" = "sk_track3_987654321" } `
  -Body (@{
    language = "Tamil"
    audioFormat = "mp3"
    audioBase64 = "<base64-audio>"
  } | ConvertTo-Json) `
  -ContentType "application/json"
```

## Frontend Demo Features

The frontend provides:
- landing page plus workspace flow
- drag-and-drop audio upload
- evaluator-friendly transcript view
- native transcript toggle
- speaker stats
- raw JSON view
- downloadable CSV report
- downloadable PDF report

## Reliability / Evaluation Notes

To support the evaluation criteria from the PDF:
- HTTP requests use retry-enabled sessions
- responses include `X-Process-Time-Ms`
- `/health` exposes backend readiness and vector stats
- transcripts are indexed for semantic search
- request/response validation is enforced with Pydantic models

## Known Scope

This repository is optimized for the hackathon evaluation flow:
- single-call processing
- JSON-first output
- strong demo UX for transcript review

It is not yet a production multi-tenant platform with background job queues, RBAC, or webhook-based STT orchestration.
