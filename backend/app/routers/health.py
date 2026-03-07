from fastapi import APIRouter

router = APIRouter()
# Dummy file to test if server is up.
@router.get("/api/health")
async def health():
    return {"status": "ok"}