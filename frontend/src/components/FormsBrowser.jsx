import React, { useEffect, useMemo, useState } from "react";
import { apiJson } from "../lib/api";

// Convert Windows paths like "storage\\forms\\scr_1\\v1\\template_1.jpg"
// into URL paths like "/storage/forms/scr_1/v1/template_1.jpg"
function toStorageUrl(p) {
  if (!p) return "";
  const normalized = String(p).replaceAll("\\", "/");
  // If path starts with "storage/...", expose it at "/storage/..."
  if (normalized.startsWith("storage/")) return "/" + normalized;
  // If it's already "/storage/.."
  if (normalized.startsWith("/storage/")) return normalized;
  // Fallback: try to treat it as relative to /storage
  return "/storage/" + normalized.replace(/^\/+/, "");
}

export default function FormsBrowser() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null); // template detail response
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadTemplates() {
    setError("");
    setBusy(true);
    try {
      const data = await apiJson("/api/forms");
      setTemplates(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Failed to load templates");
    } finally {
      setBusy(false);
    }
  }

  async function loadTemplate(formType) {
    setError("");
    setBusy(true);
    try {
      const data = await apiJson(`/api/forms/${encodeURIComponent(formType)}`);
      setSelected(data);
    } catch (err) {
      setError(err?.message || "Failed to load template");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  const selectedPreviewUrl = useMemo(() => {
    const p = selected?.templateImagePaths?.[0];
    return p ? toStorageUrl(p) : "";
  }, [selected]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Templates</h2>
        <button onClick={loadTemplates} disabled={busy}>
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        {/* Left: list */}
        <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Active Templates</h3>

          {busy && templates.length === 0 ? (
            <div>Loading…</div>
          ) : templates.length === 0 ? (
            <div>No templates found.</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {templates.map((t) => {
                const key = t.formType;
                return (
                  <li key={key}>
                    <button
                      style={{ width: "100%", textAlign: "left" }}
                      onClick={() => loadTemplate(t.formType)}
                      disabled={busy}
                    >
                      <div style={{ fontWeight: 600 }}>
                        {t.displayName || t.formType}
                      </div>
                      <small>
                        formType: {t.formType} • v{t.version}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: detail */}
        <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Template Detail</h3>

          {!selected ? (
            <div>Select a template to view details.</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div><b>displayName:</b> {selected.displayName}</div>
                <div><b>formType:</b> {selected.formType}</div>
                <div><b>version:</b> {selected.version}</div>
              </div>

              {selectedPreviewUrl ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <b>Preview</b>
                  <img
                    src={selectedPreviewUrl}
                    alt="Template preview"
                    style={{
                      maxWidth: "100%",
                      border: "1px solid #eee",
                      borderRadius: 8,
                    }}
                    onError={() => {
                      // If this fails, your backend isn't serving /storage yet,
                      // or proxy/base URL isn't set correctly.
                    }}
                  />
                  <small style={{ opacity: 0.7 }}>
                    {selected.templateImagePaths?.[0]}
                  </small>
                </div>
              ) : (
                <div>No template image path available.</div>
              )}

              <details>
                <summary>JSON Schema</summary>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(selected.jsonSchema || {}, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}