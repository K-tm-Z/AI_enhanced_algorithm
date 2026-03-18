# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] - 2026-03-18

### Added

- **Batch STT workflow (backend)**  
  - `POST /api/stt/batches/from-audio` — transcribe audio (`batch_forms` segment type), segment transcript, create form batch + one draft per segment.  
  - `POST /api/stt/batches/from-transcript` — same pipeline from pasted transcript (no audio).  
  - `POST /api/stt/batches/from-audio-with-filled-forms` — audio + optional list of filled form files (PDF or image); count must match segment count; attaches rasterized/image bytes per draft for multimodal extraction.  
  - Duplicate route registrations on STT router so both `/batches/...` and `/api/stt/batches/...` resolve (proxy-friendly).

- **`backend/app/services/segmentation_service.py`**  
  - LLM-based splitting of long transcripts into `{ formId, transcript }` segments using **active** `form_templates` from MongoDB.  
  - Requires `OPENROUTER_API_KEY`; returns ordered segments for batch draft creation.

- **`backend/app/services/filled_form_service.py`**  
  - Loads uploaded “filled form” files: **images** pass through; **PDFs** convert first page to PNG via PyMuPDF (`fitz`).  
  - MIME sniffing via `filetype`; normalized mime for multimodal pipeline.

- **Template wizard (backend + forms router)**  
  - `POST /api/forms/templates/preview-pages` — rasterize blank PDF or image to base64 PNG page previews (max ~35 MB upload).  
  - `POST /api/forms/templates/wizard` — create template from blank form + `fieldsJson` (+ optional `fieldRegionsJson`); builds `jsonSchema`, stores rasterized template pages.

- **Frontend**  
  - **Batch tab** (`BatchTab.tsx`) for batch-from-audio / transcript (and related UX).  
  - **Template wizard modal** (`TemplateWizardModal.tsx`) replacing the older template builder flow.  
  - **`frontend/src/hooks/`** — shared hooks for dashboard/wizard behavior.  
  - **`frontend/src/utils/storageUrl.ts`** — helpers for storage URLs.  
  - **`templates/`** — sample or reference template assets (when present).

### Changed

- **`backend/app/services/form_service.py`** — large expansion: wizard-based template creation, preview rasterization, batch/draft lifecycle, bulk transcripts, re-extract, finalize, archive, etc. (aligned with new routers).

- **`backend/app/routers/forms.py`** — wizard endpoints, filled-form integration hooks, extended batch/draft routes as in current API surface.

- **`backend/app/routers/stt.py`** — batch creation endpoints, shared `_build_batch_from_segmented_transcript`, filled-form batch variant.

- **`backend/requirements.txt`** — added **PyMuPDF** (`pymupdf`), **filetype**, **imageio-ffmpeg**, **ReportLab**, **Pillow**; trimmed unused Google/LangChain-google stack; pinned core FastAPI/Starlette/Uvicorn stack; documented “do not install standalone `fitz` package”.

- **Frontend dashboard** — `Dashboard.tsx`, `CreateTab.tsx`, `TemplatesTab.tsx`, `Sidebar.tsx`, `TabNav.tsx`, modals (`CreateDraftModal.tsx`), styling (`App.css`), `api.ts`, form types — updated for batch workflow and template wizard.

- **`frontend/vite.config.ts`** — dev proxy for `/api` and `/storage` to backend `4001` (replaces removed `vite.config.mts`).

- **`README.md`** — expanded setup, env table, feature summary, API overview, project structure, pymupdf note.

### Removed

- **`frontend/src/components/modals/TemplateBuilderModal.tsx`** — superseded by template wizard modal.

- **`frontend/vite.config.mts`** — consolidated into `vite.config.ts`.

### Fixed / reliability

- Batch creation fails clearly when transcript is empty, segmentation returns no segments, or filled-form file count mismatches segment count.

- Segmentation fails fast when no active templates or `OPENROUTER_API_KEY` is missing.

---

## [0.1.0] - 2026-03-04 (approx.)

### Added

- **Initial application (“First Commit - Full Core Functions”)**  
  - FastAPI app with MongoDB, JWT auth, static `/storage` for template images.  
  - Form templates CRUD-style upload (`jsonSchema` + template images), form processing, drafts, batches, finalize flows.  
  - STT transcribe endpoint with structured extraction agent + **demo mock fallback** on AI errors.  
  - React dashboard: create flow, templates, drafts, multimodal-related UI pieces.  
  - Health router, form collection migrations.

- **Schema update commit** — incremental schema/type adjustments for forms.

---

**Repository:** [github.com/K-tm-Z/AI_enhanced_algorithm](https://github.com/K-tm-Z/AI_enhanced_algorithm)  

When you tag releases, add compare links here, e.g. `[Unreleased]: …/compare/v0.2.0…HEAD`.
