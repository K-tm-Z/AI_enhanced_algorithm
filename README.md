## 🚀 Getting Started

### 1. Prerequisites
- Python 3.10+
- Node.js 16+
- A valid `.env` file with `OPENROUTER_API_KEY`

### 2. Installation

#### Backend
```bash
cd backend/
python -m venv .venv

# Activate virtual environment
.\.venv\Scripts\Activate.ps1       # PowerShell
.\.venv\Scripts\activate           # cmd
source .venv/bin/activate         # Mac/Linux

pip install -r requirements.txt
```

#### Frontend
```bash
cd frontend/
npm install
```

### 3. Running the Application

#### Backend
```bash
uvicorn app.main:app --port 4001              # Production
uvicorn app.main:app --reload --port 4001     # Development
```

#### Frontend
```bash
npm run dev
```

### 4. Environment Variables
Create a `.env` file in the root directory:
```
OPENROUTER_API_KEY=your_api_key_here
```

### 5. Project Structure
```
.
├── backend/          # FastAPI application
├── frontend/         # React/Vue application
└── README.md
```