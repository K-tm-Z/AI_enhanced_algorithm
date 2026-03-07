# services/auth_service.py
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Tuple

import bcrypt
from jose import jwt

from ..config import settings
from ..db import get_client

def _db():
    return get_client().get_default_database()

def _hash_password(password: str) -> str:
    if not password or len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    salt = bcrypt.gensalt(rounds=int(settings.BCRYPT_ROUNDS))
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False

def _issue_access_token(*, user_id: str, scopes: list[str], role: str) -> tuple[str, datetime]:
    if not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET is not configured")

    expires_at = datetime.utcnow() + timedelta(minutes=int(settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {
        "sub": user_id,
        "scopes": scopes,
        "role": role,
        "exp": int(expires_at.timestamp()),
        "iat": int(datetime.utcnow().timestamp()),
        "typ": "access",
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, expires_at

async def register_user(
    *,
    email: str,
    password: str,
    first_name: str | None,
    last_name: str | None,
) -> Tuple[dict[str, Any] | None, tuple[str, int] | None]:
    db = _db()
    users = db["users"]

    norm_email = (email or "").strip().lower()
    if not norm_email:
        return None, ("Email is required", 400)

    existing = await users.find_one({"email": norm_email})
    if existing:
        return None, ("Email already registered", 409)

    try:
        password_hash = _hash_password(password)
    except ValueError as e:
        return None, (str(e), 400)

    user_doc = {
        "email": norm_email,
        "passwordHash": password_hash,
        "firstName": first_name,
        "lastName": last_name,
        "status": "active",
        "role": "user",
        "allowedScopes": [],
        "createdAt": datetime.utcnow(),
    }
    ins = await users.insert_one(user_doc)
    user_id = str(ins.inserted_id)

    token, expires_at = _issue_access_token(user_id=user_id, scopes=[], role="user")

    return {
        "accessToken": token,
        "expiresAt": expires_at,
        "user": {
            "id": user_id,
            "email": norm_email,
            "firstName": first_name,
            "lastName": last_name,
            "role": "user",
        },
    }, None

async def login_user(
    *,
    email: str,
    password: str,
) -> Tuple[dict[str, Any] | None, tuple[str, int] | None]:
    db = _db()
    users = db["users"]

    norm_email = (email or "").strip().lower()
    if not norm_email or not password:
        return None, ("Invalid email or password", 401)

    user = await users.find_one({"email": norm_email})
    if not user or user.get("status") != "active":
        return None, ("Invalid email or password", 401)

    if not _verify_password(password, user.get("passwordHash", "")):
        return None, ("Invalid email or password", 401)

    scopes = user.get("allowedScopes") if isinstance(user.get("allowedScopes"), list) else []
    role = user.get("role", "user")
    user_id = str(user["_id"])
    token, expires_at = _issue_access_token(user_id=user_id, scopes=scopes, role=role)

    return {
        "accessToken": token,
        "expiresAt": expires_at,
        "user": {
            "id": user_id,
            "email": user.get("email"),
            "firstName": user.get("firstName"),
            "lastName": user.get("lastName"),
            "role": role,
        },
    }, None

async def get_user_public(user_id: str) -> Tuple[dict[str, Any] | None, tuple[str, int] | None]:
    from bson import ObjectId

    db = _db()
    users = db["users"]

    try:
        oid = ObjectId(user_id)
    except Exception:
        return None, ("Invalid user id", 400)

    user = await users.find_one({"_id": oid})
    if not user:
        return None, ("User not found", 404)

    return {
        "id": str(user["_id"]),
        "email": user.get("email"),
        "firstName": user.get("firstName"),
        "lastName": user.get("lastName"),
        "role": user.get("role", "user"),
    }, None