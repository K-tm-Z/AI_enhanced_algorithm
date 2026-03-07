# routers/auth.py
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr
from typing import Optional

from ..config import settings
from ..services import auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

class RegisterReq(BaseModel):
    email: EmailStr
    password: str
    firstName: Optional[str] = None
    lastName: Optional[str] = None

@router.post("/register", status_code=201)
async def register(body: RegisterReq):
    data, err = await auth_service.register_user(
        email=body.email,
        password=body.password,
        first_name=body.firstName,
        last_name=body.lastName,
    )
    if err:
        msg, code = err
        raise HTTPException(status_code=code, detail=msg)
    return data

class LoginReq(BaseModel):
    email: EmailStr
    password: str

@router.post("/login")
async def login(body: LoginReq):
    data, err = await auth_service.login_user(email=body.email, password=body.password)
    if err:
        msg, code = err
        raise HTTPException(status_code=code, detail=msg)
    return data

def _get_user_id_from_token(token: str = Depends(oauth2_scheme)) -> str:
    if not settings.JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT_SECRET is not configured")
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        sub = payload.get("sub")
        if not isinstance(sub, str) or not sub:
            raise HTTPException(status_code=401, detail="Invalid token")
        return sub
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

@router.get("/me")
async def me(user_id: str = Depends(_get_user_id_from_token)):
    data, err = await auth_service.get_user_public(user_id)
    if err:
        msg, code = err
        raise HTTPException(status_code=code, detail=msg)
    return {"user": data}