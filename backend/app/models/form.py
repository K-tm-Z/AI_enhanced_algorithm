from datetime import datetime, timezone
from typing import List, Optional, Literal, Any

from pydantic import BaseModel, Field


class FormTemplateInDB(BaseModel):
    formId: str = Field(..., alias="_id")
    name: str
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    version: int = 1
    isActive: bool = True
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FormDraftInDB(BaseModel):
    draftId: str = Field(..., alias="_id")
    formId: str
    batchId: str
    sequenceNumber: int
    reviewStatus: Literal["approved", "rejected", "in_review"] = "in_review"
    sourceType: Literal["image", "pdf", "audio"] = "audio"
    sourceIndex: int
    previewUrl: Optional[str] = None
    status: Literal["draft", "submitted", "approved", "rejected"] = "draft"
    payload: dict[str, Any] = Field(default_factory=dict)
    validationErrors: List[dict[str, Any]] = Field(default_factory=list)
    validationWarnings: List[dict[str, Any]] = Field(default_factory=list)
    transcript: Optional[str] = None
    runId: Optional[str] = None
    finalizedAt: Optional[datetime] = None
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FormFieldInDB(BaseModel):
    fieldId: str = Field(..., alias="_id")
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


class FormBatchInDB(BaseModel):
    batchId: str = Field(..., alias="_id")
    createdBy: str
    status: Literal["processing", "completed"] = "processing"
    totalDrafts: int = 0
    approvedCount: int = 0
    rejectedCount: int = 0
    finalizedCount: int = 0
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))