## 🚀 Getting Started

### 1. Prerequisites
- Python 3.10+
- A valid `.env` file with `OPENROUTER_API_KEY`

### 2-a. Backend Installation

```bash
cd backend/

.\.venv\Scripts\Activate.ps1 #PowerShell
.\.venv\Scripts\activate #cmd
source .venv/bin/activate #Mac/Linux
source .venv/Scripts/activate #bash

pip install -r requirements.txt

uvicorn app.main:app --port 4001 #regular launch
uvicorn app.main:app --reload --port 4001 #automated updates, can cause freeze if crash
```

### 2-b. Frontend Installation

```bash
cd frontend/

npm install

npm run
```