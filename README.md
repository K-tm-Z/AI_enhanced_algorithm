# AI-enhanced form workflow

FastAPI + React app for **speech-to-text**, **multi-form batch processing**, and **template-based form extraction** using OpenRouter (LLM) and optional multimodal input (filled PDFs/images).

## Features

| Area | What it does |
|------|----------------|
| **Auth** | JWT-backed login; protected form and STT batch APIs. |
| **Templates** | Upload JSON-schema templates **or** use the **template wizard**: blank PDF/image → page previews → define fields (and optional regions) → stored template pages + schema. |
| **Single flow** | Transcribe audio, run structured extraction against a chosen template. |
| **Batch flow** | One recording or pasted transcript split into **multiple form segments** (by active template IDs); creates a batch with one draft per segment. |
| **Filled forms** | Optional per-segment PDF/image uploads; first PDF page is rasterized for multimodal extraction (`pymupdf`). |

## Tech stack

- **Backend:** FastAPI, Motor/MongoDB, LangChain / OpenAI-compatible API (OpenRouter), PyMuPDF, Pillow, ReportLab  
- **Frontend:** React 18, Vite 6, React Router 7  

## Prerequisites

- **Python** 3.10+  
- **Node.js** 18+ (16+ may work)  
- **MongoDB** reachable from your machine  
- **OpenRouter** API key  

## Quick start

### 1. Clone and environment

```bash
git clone https://github.com/K-tm-Z/AI_enhanced_algorithm.git
cd AI_enhanced_algorithm
```

Create **`backend/.env`** (the app loads settings from there):

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | LLM + segmentation calls |
| `MONGO_URI` | Yes | e.g. `mongodb://localhost:27017/your_db` |
| `JWT_SECRET` | Yes | Token signing secret |

Optional: `STORAGE_DIR` for uploaded template assets (defaults under project storage).

### 2. Backend

```bash
cd backend
python -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# Windows cmd
.\.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --port 4001
```

API root: `http://127.0.0.1:4001` — docs at `/docs`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies **`/api`** and **`/storage`** to the backend on port **4001**, so use the Vite URL (e.g. `http://localhost:5173`) during development.

### 4. Production build (frontend)

```bash
cd frontend
npm run build
npm run preview   # optional local preview of build
```

## API overview (high level)

- **`/api/auth/*`** — register, login, token refresh  
- **`/api/forms/*`** — list templates, get schema, upload template, **wizard** (`/templates/preview-pages`, `/templates/wizard`), drafts, batches, finalize  
- **`/api/stt/transcribe`** — transcribe + structured extraction (demo fallback if AI fails)  
- **`/api/stt/batches/from-audio`** — STT → segment → batch + drafts *(auth)*  
- **`/api/stt/batches/from-transcript`** — same from pasted text *(auth)*  
- **`/api/stt/batches/from-audio-with-filled-forms`** — audio + matching count of filled PDFs/images per segment *(auth)*  
- **`/storage/*`** — static template images  

> **Note:** Batch segmentation needs at least one **active** form template in MongoDB.

## Project structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, CORS, /storage mount
│   │   ├── routers/             # auth, forms, stt, health
│   │   ├── services/            # form, STT, segmentation, filled PDF/image
│   │   └── ...
│   ├── requirements.txt
│   └── .env                     # create locally (not committed)
├── frontend/
│   ├── src/
│   │   ├── components/          # Dashboard, Batch tab, wizard modals, etc.
│   │   ├── lib/                 # api, auth helpers
│   │   └── ...
│   └── vite.config.ts
├── templates/                   # sample / reference templates (if present)
├── CHANGELOG.md
└── README.md
```

## Dependencies worth knowing

- **PDF handling:** install **`pymupdf`** (imported as `fitz`). Do **not** install the PyPI package named `fitz` alone — use `pymupdf` as in `requirements.txt`.  
- **Batch + wizard** rely on **OpenRouter** and **MongoDB** being configured.

## Changelog

See **[CHANGELOG.md](./CHANGELOG.md)** for version history and detailed changes.

## License

See repository license (if any).
