import React, { useEffect, useState } from "react";
import { sendJson } from "../../lib/api";
import type { BackendDraft, BackendTemplateDetail } from "../../types/forms";
import { flattenValidation, getValidationMessage, prettyLabel } from "../../utils/formHelpers";

const DraftReviewModal: React.FC<{
  isOpen: boolean;
  draft: BackendDraft | null;
  template: BackendTemplateDetail | null;
  onClose: () => void;
  onSaved: (draft: BackendDraft) => void;
  onFinalized: (result: { run?: { runId?: string } } | Record<string, unknown>) => void;
}> = ({ isOpen, draft, template, onClose, onSaved, onFinalized }) => {
  const [formState, setFormState] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (draft?.payload) {
      setFormState(draft.payload);
    }
  }, [draft]);

  if (!isOpen || !draft) return null;

  const validation = flattenValidation(draft.validation);
  const schemaProps = template?.jsonSchema?.properties ?? {};
  const fieldNames = Array.from(new Set([...Object.keys(schemaProps), ...Object.keys(formState || {})]));

  const handleChange = (field: string, rawValue: string, type?: string) => {
    let value: unknown = rawValue;

    if (type === "number" || type === "integer") {
      value = rawValue === "" ? "" : Number(rawValue);
    } else if (type === "boolean") {
      value = rawValue === "true";
    }

    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);

    try {
      const updated = await sendJson<BackendDraft>(`/api/forms/drafts/${draft.draftId}`, "PATCH", formState);
      onSaved(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Draft update failed");
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    setBusy(true);
    setError(null);

    try {
      const result = await sendJson(`/api/forms/drafts/${draft.draftId}/finalize`, "POST", formState);
      onFinalized(result as { run?: { runId?: string } });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Draft finalization failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card modal-card-wide">
        <div className="modal-header-block">
          <h2>Review extracted data</h2>
          <p>{draft.formType} · draft {draft.draftId.slice(0, 8)}</p>
        </div>

        <div className="modal-form">
          {fieldNames.map((field) => {
            const config = schemaProps[field];
            const fieldType = config?.type || "string";
            const value = formState[field];
            const errorMessage = getValidationMessage(validation.errors, field);
            const warningMessage = getValidationMessage(validation.warnings, field);

            return (
              <div key={field}>
                <label className="modal-label">
                  {config?.title || prettyLabel(field)}
                  {config?.enum ? (
                    <select
                      value={String(value ?? "")}
                      onChange={(event) => handleChange(field, event.target.value, fieldType)}
                    >
                      <option value="">Select...</option>
                      {config.enum.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={fieldType === "number" || fieldType === "integer" ? "number" : "text"}
                      value={String(value ?? "")}
                      onChange={(event) => handleChange(field, event.target.value, fieldType)}
                    />
                  )}
                </label>

                {errorMessage && <div className="error-text">{errorMessage}</div>}
                {warningMessage && <div className="warning-text">{warningMessage}</div>}
              </div>
            );
          })}

          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="modal-actions modal-actions-spread">
          <button onClick={onClose} className="modal-cancel">
            Close
          </button>

          <div className="modal-actions-group">
            <button onClick={handleSave} className="secondary-button" disabled={busy}>
              {busy ? "Working..." : "Save Changes"}
            </button>
            <button onClick={handleFinalize} className="modal-submit" disabled={busy}>
              {busy ? "Working..." : "Finalize Draft"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DraftReviewModal;
