from pydantic import BaseModel, Field, Tag
from datetime import datetime
from typing import Annotated, Literal, Union, Optional, List


class DistributionLog(BaseModel):
    form_type: Literal["distribution_log"] = Field(default="distribution_log")
    date_time: datetime = Field(
        description="The date and time of the logged activity in YYYY-MM-DD HH:MM format."
    )
    staff_first_name: str = Field(description="First name of the staff member")
    staff_last_name: str = Field(description="Last name of the staff member")
    staff_id: str = Field(description="Identifier of the staff member")
    secondary_staff_first_name: Optional[str] = Field(default=None, description="First name of the second staff member, if applicable")
    secondary_staff_last_name: Optional[str] = Field(default=None, description="Last name of the second staff member, if applicable")
    secondary_staff_id: Optional[str] = Field(default=None, description="Identifier of the second staff member, if applicable")
    recipient_age: int = Field(description="Age of the recipient")
    recipient_category: Literal["client", "family_member", "visitor", "other"] = Field(description="Category of the recipient")
    item_type: str = Field(description="Type of item or support distributed")


class IncidentReport(BaseModel):
    form_type: Literal["incident_report"] = Field(default="incident_report")
    date: str = Field(description="Date in YYYY-MM-DD format")
    time: str = Field(description="Time in HH:MM 24-hour format")
    report_id: str = Field(description="Unique identifier for the report")
    category: str = Field(description="Category of the incident")
    reference_number: str = Field(description="Reference number for the incident")
    summary: str = Field(description="Short description of the incident")
    severity: str = Field(description="Severity or priority level")
    severity_details: str = Field(description="Additional details about severity")
    service_area: str = Field(description="Service area or department involved")
    asset_id: str = Field(description="Identifier for related asset, vehicle, or equipment")
    asset_description: str = Field(description="Description of related asset, vehicle, or equipment")
    reporter_role: str = Field(description="Role of the reporting staff member")
    reporter_role_details: str = Field(description="Additional details about the reporter role")
    staff_id: str = Field(description="Identifier of the reporting staff member")
    external_party_a: bool = Field(description="Whether an external party of type A was involved")
    external_party_b: bool = Field(description="Whether an external party of type B was involved")
    observations: str = Field(description="Additional observations")
    suggested_resolution: str = Field(description="Suggested follow-up or resolution")
    action_taken: str = Field(description="Actions taken")
    management_notes: str = Field(description="Management or operational notes")
    requested_by: str = Field(description="Name of the requester")
    requested_by_details: str = Field(description="Additional requester details")
    report_creator: str = Field(description="Name of the report creator")
    report_creator_details: str = Field(description="Additional report creator details")


class ChecklistEntry(BaseModel):
    item_code: str
    status: Literal["GOOD", "BAD"]
    notes: str = Field(description="Details about the checklist item")


class InspectionChecklist(BaseModel):
    form_type: Literal["inspection_checklist"] = Field(default="inspection_checklist")
    entries: List[ChecklistEntry]
    total_issues_found: int


class StructuredDocument(BaseModel):
    form: Annotated[
        Union[
            Annotated[DistributionLog, Tag("distribution_log")],
            Annotated[IncidentReport, Tag("incident_report")],
            Annotated[InspectionChecklist, Tag("inspection_checklist")],
        ],
        Field(discriminator="form_type")
    ]