import React, { useEffect, useState } from "react";
import { sendFormData } from "../../lib/api";
import type { BackendDraft, BackendTemplateSummary } from "../../types/forms";
import { prettyLabel } from "../../utils/formHelpers";

const CreateDraftModal: React.FC<{
  isOpen: boolean;
  template: BackendTemplateSummary | null;
  onClose: () => void;
  onCreated: (draft: BackendDraft) => void;
}> = ({ isOpen, template, onClose, onCreated }) => {
  const [transcript, setTranscript] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setTranscript("");
      setImageFile(null);
      setError(null);
      setBusy(false);
    }
  }, [isOpen]);

  if (!isOpen || !template) return null;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("formType", template.formType);
      formData.append("transcript", transcript);
      if (imageFile) {
        formData.append("filledFormImage", imageFile);
      }

      const draft = await sendFormData<BackendDraft>("/api/forms/drafts", "POST", formData);
      onCreated(draft);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Draft creation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header-block">
          <h2>Create draft</h2>
          <p>{template.displayName || prettyLabel(template.formType)} · v{template.version}</p>
        </div>

        <div className="modal-form">
          <label className="modal-label">
            Transcript
            <textarea
              rows={8}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="Paste transcript text here, or prepare to connect audio capture later."
            />
          </label>

          <label className="modal-label">
            Optional Filled Form Image
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
            />
          </label>

          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="modal-cancel">
            Cancel
          </button>
          <button onClick={handleSubmit} className="modal-submit" disabled={busy}>
            {busy ? "Creating..." : "Create Draft"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateDraftModal;
