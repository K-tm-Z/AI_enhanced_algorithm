from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class FormInDB(BaseModel):
    id: str = Field(..., alias="_id")
    name: str
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    version: int = 1
    isActive: bool = True
    createdAt: datetime = Field(default_factory=datetime.utcnow)
    updatedAt: datetime = Field(default_factory=datetime.utcnow)


class FormFieldInDB(BaseModel):
    id: str = Field(..., alias="_id")
    formId: str
    name: str
    label: str
    type: str = "text"
    required: bool = False
    pageIndex: int = 0
    x: float
    y: float
    width: float
    height: float
    pattern: Optional[str] = None
    options: Optional[List[str]] = None

