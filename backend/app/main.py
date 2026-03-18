from fastapi import FastAPI
from fastapi.encoders import ENCODERS_BY_TYPE
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from bson import ObjectId
import os

from .config import settings

# MongoDB insert_one mutates docs with _id: ObjectId; FastAPI cannot JSON-encode it by default.
ENCODERS_BY_TYPE[ObjectId] = str

from .db import close_db, get_db, init_db
from .migrations.forms import ensure_form_collections
from .routers.auth import router as auth_router
from .routers.forms import router as forms_router
from .routers.health import router as health_router
from .routers.stt import router as stt_router

app = FastAPI()
print("CWD:", os.getcwd())
print(f"Storage dir: {getattr(settings, 'STORAGE_DIR', 'storage')}")
print(f"Mongo URI: {settings.MONGO_URI}")
print(f"OpenRouter API Key: {settings.OPENROUTER_API_KEY[:20]}...")  # Show first 20 characters
# Serve files under /storage/* from local ./storage folder
# Example URL: http://localhost:4001/storage/forms/scr_1/v1/template_1.jpg
storage_dir = getattr(settings, "STORAGE_DIR", "storage")
os.makedirs(storage_dir, exist_ok=True)
app.mount("/storage", StaticFiles(directory=storage_dir), name="storage")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    await init_db()
    # Run lightweight "migrations" when Mongo is available (creates collections/indexes).
    try:
        db = get_db()
        print("MongoDB connected, ensuring form collections/indexes...")
    except RuntimeError:
        db = None
    if db is not None:
        await ensure_form_collections(db)


@app.on_event("shutdown")
async def shutdown():
    await close_db()


app.include_router(health_router)
app.include_router(auth_router)
app.include_router(forms_router)
app.include_router(stt_router)