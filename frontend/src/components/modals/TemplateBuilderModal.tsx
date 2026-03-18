import React, { useState } from "react";
import { sendFormData } from "../../lib/api";
import type { TemplateField } from "../../types/forms";
import { makeSchemaFromFields, normalizeKey } from "../../utils/formHelpers";

const TemplateBuilderModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onUploaded: () => void;
}> = ({ isOpen, onClose, onUploaded }) => {
  const [formType, setFormType] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [version, setVersion] = useState<number | string>(1);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [fields, setFields] = useState<TemplateField[]>([
    { key: "report_id", type: "string", required: true },
    { key: "summary", type: "string", required: true },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setImageFiles(Array.from(event.target.files || []));
  };

  const updateField = (index: number, patch: Partial<TemplateField>) => {
    setFields((current) =>
      current.map((field, currentIndex) =>
        currentIndex === index ? { ...field, ...patch } : field,
      ),
    );
  };

  const addField = () => {
    setFields((current) => [...current, { key: "", type: "string", required: false }]);
  };

  const removeField = (index: number) => {
    setFields((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const resetForm = () => {
    setFormType("");
    setDisplayName("");
    setVersion(1);
    setImageFiles([]);
    setFields([{ key: "report_id", type: "string", required: true }]);
  };

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);

    try {
      const schema = makeSchemaFromFields(fields);
      const formData = new FormData();
      formData.append("formType", formType.trim());
      formData.append("displayName", displayName.trim() || formType.trim());
      formData.append("version", String(version));
      formData.append("jsonSchema", JSON.stringify(schema));

      imageFiles.forEach((file) => {
        formData.append("templateImages", file);
      });

      await sendFormData("/api/forms/templates", "POST", formData);
      resetForm();
      onUploaded();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Template upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card modal-card-wide">
        <div className="modal-header-block">
          <h2>Upload template</h2>
          <p>Register a new template with a generic JSON schema and one or more reference images.</p>
        </div>

        <div className="modal-form">
          <label className="modal-label">
            Form Type
            <input
              value={formType}
              onChange={(event) => setFormType(normalizeKey(event.target.value))}
              placeholder="e.g. incident_report"
            />
          </label>

          <label className="modal-label">
            Display Name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Incident Report"
            />
          </label>

          <label className="modal-label">
            Version
            <input
              type="number"
              value={version}
              onChange={(event) => setVersion(event.target.value)}
              min={1}
            />
          </label>

          <label className="modal-label">
            Template Images
            <input type="file" accept="image/*" multiple onChange={handleFileChange} />
          </label>

          <div className="builder-section">
            <div className="builder-header">
              <h3>Schema Fields</h3>
              <button type="button" className="secondary-button" onClick={addField}>
                Add Field
              </button>
            </div>

            <div className="builder-grid">
              {fields.map((field, index) => (
                <div key={`${field.key}-${index}`} className="builder-row">
                  <input
                    value={field.key}
                    onChange={(event) => updateField(index, { key: event.target.value })}
                    placeholder="field_name"
                  />

                  <select
                    value={field.type}
                    onChange={(event) =>
                      updateField(index, {
                        type: event.target.value as TemplateField["type"],
                      })
                    }
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </select>

                  <label className="checkbox-inline">
                    <input
                      type="checkbox"
                      checked={Boolean(field.required)}
                      onChange={(event) => updateField(index, { required: event.target.checked })}
                    />
                    Required
                  </label>

                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => removeField(index)}
                    disabled={fields.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="modal-actions">
          <button onClick={onClose} className="modal-cancel">
            Cancel
          </button>
          <button onClick={handleSubmit} className="modal-submit" disabled={busy}>
            {busy ? "Uploading..." : "Upload Template"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateBuilderModal;
