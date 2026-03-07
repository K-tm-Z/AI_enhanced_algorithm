from typing import Any


async def ensure_form_collections(db: Any) -> None:
    """
    Ensure Mongo collections and indexes for forms and form fields exist.
    """
    forms = db["forms"]
    form_fields = db["form_fields"]

    # Forms: index by name and active flag for quick listing/filtering
    await forms.create_index("name")
    await forms.create_index("isActive")

    # Form fields: index by formId and (formId, name) pair for fast lookup
    await form_fields.create_index("formId")
    await form_fields.create_index([("formId", 1), ("name", 1)], unique=True)

