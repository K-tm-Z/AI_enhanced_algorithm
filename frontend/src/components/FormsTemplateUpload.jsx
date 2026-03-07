import React, { useMemo, useState } from "react";
import { apiFormData } from "../lib/api";

const TYPE_OPTIONS = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date (string)" },
];

function normalizeKey(s) {
  // Mongo-like: simple key normalization
  return (s || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/^(\d)/, "_$1");
}

function makeSchemaFromFields(fields) {
  const properties = {};
  const required = [];

  for (const f of fields) {
    const key = normalizeKey(f.key);
    if (!key) continue;

    if (f.type === "date") {
      properties[key] = { type: "string", format: "date" };
    } else {
      properties[key] = { type: f.type };
    }

    if (f.required) required.push(key);
  }

  const schema = {
    type: "object",
    properties,
    additionalProperties: false,
  };

  if (required.length) schema.required = required;

  return schema;
}

export default function FormsTemplateUpload() {
  const [formType, setFormType] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [version, setVersion] = useState(1);
  const [images, setImages] = useState([]);

  const [fields, setFields] = useState([
    { id: crypto.randomUUID(), key: "patientName", type: "string", required: true },
    { id: crypto.randomUUID(), key: "incidentDate", type: "date", required: true },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const schemaObj = useMemo(() => makeSchemaFromFields(fields), [fields]);
  const schemaText = useMemo(() => JSON.stringify(schemaObj, null, 2), [schemaObj]);

  const canSubmit = useMemo(() => {
    const ft = formType.trim();
    const dn = displayName.trim();
    return ft && dn && images.length > 0 && Object.keys(schemaObj.properties || {}).length > 0;
  }, [formType, displayName, images, schemaObj]);

  function addField() {
    setFields((prev) => [
      ...prev,
      { id: crypto.randomUUID(), key: "", type: "string", required: false },
    ]);
  }

  function deleteField(id) {
    setFields((prev) => prev.filter((f) => f.id !== id));
  }

  function updateField(id, patch) {
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setResult(null);

    // Guardrails: unique keys + non-empty keys
    const keys = fields
      .map((f) => normalizeKey(f.key))
      .filter(Boolean);

    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length) {
      setError(`Duplicate field key(s): ${Array.from(new Set(dupes)).join(", ")}`);
      return;
    }
    if (keys.length === 0) {
      setError("Add at least one field.");
      return;
    }

    const fd = new FormData();
    fd.append("formType", formType.trim());
    fd.append("displayName", displayName.trim());
    fd.append("version", String(parseInt(version, 10)));
    fd.append("jsonSchema", schemaText);

    // Backend expects this exact name: templateImages :contentReference[oaicite:1]{index=1}
    images.forEach((file) => fd.append("templateImages", file, file.name));

    setBusy(true);
    try {
      const data = await apiFormData("/api/forms/templates", { formData: fd });
      setResult(data);
    } catch (err) {
      setError(err?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>Upload Form Template (Schema Builder)</h2>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 140px", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>formType (unique key)</span>
            <input
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
              placeholder="e.g., nda_v1"
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>displayName</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g., NDA Form"
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>version</span>
            <input
              type="number"
              min={1}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </label>
        </div>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Template image(s) (blank form)</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setImages(Array.from(e.target.files || []))}
          />
          {images.length > 0 && <small>{images.length} file(s) selected</small>}
        </label>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h3 style={{ margin: 0 }}>Fields</h3>
            <button type="button" onClick={addField}>
              + Add Field
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Key</th>
                  <th style={th}>Type</th>
                  <th style={th}>Required</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const normalized = normalizeKey(f.key);
                  return (
                    <tr key={f.id}>
                      <td style={td}>
                        <input
                          value={f.key}
                          onChange={(e) => updateField(f.id, { key: e.target.value })}
                          placeholder="e.g., medicNumber"
                          style={{ width: "100%" }}
                        />
                        <small style={{ opacity: 0.7 }}>
                          normalized: <code>{normalized || "(empty)"}</code>
                        </small>
                      </td>
                      <td style={td}>
                        <select
                          value={f.type}
                          onChange={(e) => updateField(f.id, { type: e.target.value })}
                        >
                          {TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={td}>
                        <input
                          type="checkbox"
                          checked={!!f.required}
                          onChange={(e) => updateField(f.id, { required: e.target.checked })}
                        />
                      </td>
                      <td style={td}>
                        <button type="button" onClick={() => deleteField(f.id)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {fields.length === 0 && (
                  <tr>
                    <td style={td} colSpan={4}>
                      No fields. Click “Add Field”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <details>
          <summary>Generated JSON Schema</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{schemaText}</pre>
        </details>

        <button type="submit" disabled={!canSubmit || busy}>
          {busy ? "Uploading..." : "Upload Template"}
        </button>

        {error && <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div>}
        {result && (
          <div style={{ color: "green", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(result, null, 2)}
          </div>
        )}
      </form>
    </div>
  );
}

const th = { borderBottom: "1px solid #ddd", padding: 8, textAlign: "left" };
const td = { borderBottom: "1px solid #eee", padding: 8, verticalAlign: "top" };