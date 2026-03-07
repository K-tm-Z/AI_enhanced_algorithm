# models/user.py
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional

class UserInDB(BaseModel):
    id: str = Field(..., alias="_id")
    email: EmailStr
    passwordHash: str
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    status: str = "active"
    role: str = "user"
    allowedScopes: List[str] = []

class UserPublic(BaseModel):
    id: str
    email: EmailStr
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    role: str