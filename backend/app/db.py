from motor.motor_asyncio import AsyncIOMotorClient
from .config import settings

_client: AsyncIOMotorClient | None = None

def get_client() -> AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError("Mongo client not initialized (MONGO_URI missing or init_db not called)")
    return _client

def get_db():
    """
    Returns the default database from the Mongo URI.
    If your URI does not include a DB name, you must select one explicitly.
    """
    if _client is None:
        raise RuntimeError("Mongo client not initialized")
        
    return get_client().get_default_database()

async def init_db():
    global _client
    if settings.MONGO_URI:
        _client = AsyncIOMotorClient(settings.MONGO_URI)
    else:
        _client = None  # allow running without Mongo

async def close_db():
    global _client
    if _client is not None:
        _client.close()
        _client = None