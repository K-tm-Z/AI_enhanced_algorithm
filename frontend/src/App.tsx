import React, { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import "./App.css";
import { clearToken, login as loginApi, me, setToken } from "./lib/auth";

type TabId = "create" | "templates" | "review";

const TABS: { id: TabId; label: string; glyph: string }[] = [
  { id: "create", label: "Create", glyph: "◎" },
  { id: "templates", label: "Templates", glyph: "▤" },
  { id: "review", label: "Review", glyph: "✦" }
];

type JsonSchemaField = {
  type?: "string" | "number" | "integer" | "boolean" | "date";
  title?: string;
  enum?: string[];
};

type JsonSchema = {
  properties?: Record<string, JsonSchemaField>;
  required?: string[];
};

type ValidationIssue = {
  path: string;
  message: string;
};

type ValidationState = {
  errors?: ValidationIssue[];
  warnings?: ValidationIssue[];
};

type BackendTemplateSummary = {
  formType: string;
  displayName?: string;
  version: number;
  templateImageUrls?: string[];
  createdAt?: string;
};

type BackendTemplateDetail = BackendTemplateSummary & {
  jsonSchema?: JsonSchema;
  promptSpec?: {
    rules?: string[];
  };
};

type BackendDraft = {
  draftId: string;
  formType: string;
  templateVersion: number;
  payload: Record<string, unknown>;
  validation?: ValidationState;
  transcript: string;
  status: string;
};

type TemplateField = {
  key: string;
  type: "string" | "number" | "date";
  required?: boolean;
};

function normalizeKey(value: string) {
  return (value || "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

function makeSchemaFromFields(fields: TemplateField[]): JsonSchema {
  const properties: Record<string, JsonSchemaField> = {};
  const required: string[] = [];

  for (const field of fields) {
    const key = normalizeKey(field.key);
    if (!key) continue;

    properties[key] = {
      type: field.type === "date" ? "string" : field.type,
      title: field.key
    };

    if (field.required) required.push(key);
  }

  return {
    properties,
    ...(required.length ? { required } : {})
  };
}

function getStoredToken() {
  return (
    localStorage.getItem("accessToken") ||
    localStorage.getItem("token") ||
    localStorage.getItem("authToken") ||
    ""
  );
}

async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = getStoredToken();
  const headers = new Headers(init.headers || {});

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(input, {
    ...init,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  return response;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await authFetch(url);
  return response.json();
}

async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await authFetch(url, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  return response.json();
}

async function sendFormData<T>(url: string, method: string, formData: FormData): Promise<T> {
  const response = await authFetch(url, {
    method,
    body: formData
  });

  return response.json();
}

function flattenValidation(validation?: ValidationState) {
  return {
    errors: validation?.errors ?? [],
    warnings: validation?.warnings ?? []
  };
}

function getValidationMessage(
  issues: ValidationIssue[] | undefined,
  path: string
): string | undefined {
  return issues?.find((issue) => issue.path === path)?.message;
}

function prettyLabel(value: string) {
  return value
    .replace(/[_\-.]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const Login: React.FC<{ onLogin: () => void }> = ({ onLogin }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setBusy(true);
    setError(null);

    try {
      const data = await loginApi(email, password);
      setToken(data.accessToken);
      onLogin();
      navigate("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <div className="glass-card login-card">
        <div className="login-kicker">Structured Document Automation</div>
        <h2>Sign in</h2>
        <p className="login-copy">
          Access the template library, create draft documents, and review extracted data before finalization.
        </p>

        <input
          type="email"
          placeholder="Email"
          className="login-input"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />

        <input
          type="password"
          placeholder="Password"
          className="login-input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />

        {error && <div className="error-text">{error}</div>}

        <button className="login-button" onClick={handleLogin} disabled={busy}>
          {busy ? "Signing in..." : "Sign In"}
        </button>
      </div>
    </div>
  );
};

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
    { key: "summary", type: "string", required: true }
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
        currentIndex === index ? { ...field, ...patch } : field
      )
    );
  };

  const addField = () => {
    setFields((current) => [...current, { key: "", type: "string", required: false }]);
  };

  const removeField = (index: number) => {
    setFields((current) => current.filter((_, currentIndex) => currentIndex !== index));
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
      setFormType("");
      setDisplayName("");
      setVersion(1);
      setImageFiles([]);
      setFields([{ key: "report_id", type: "string", required: true }]);
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
                        type: event.target.value as TemplateField["type"]
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
  const fieldNames = Array.from(
    new Set([...Object.keys(schemaProps), ...Object.keys(formState || {})])
  );

  const handleChange = (field: string, rawValue: string, type?: string) => {
    let value: unknown = rawValue;

    if (type === "number" || type === "integer") {
      value = rawValue === "" ? "" : Number(rawValue);
    } else if (type === "boolean") {
      value = rawValue === "true";
    }

    setFormState((current) => ({
      ...current,
      [field]: value
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

const Dashboard: React.FC<{ onLogout: () => void }> = ({ onLogout }) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("create");
  const [templates, setTemplates] = useState<BackendTemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<BackendTemplateSummary | null>(null);
  const [selectedTemplateDetail, setSelectedTemplateDetail] = useState<BackendTemplateDetail | null>(null);
  const [currentDraft, setCurrentDraft] = useState<BackendDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showCreateDraftModal, setShowCreateDraftModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [lastRunId, setLastRunId] = useState<string | null>(null);

  const loadTemplates = async () => {
    setBusy(true);
    setPageError(null);

    try {
      const result = await getJson<BackendTemplateSummary[]>("/api/forms");
      setTemplates(result);

      if (!selectedTemplate && result.length > 0) {
        setSelectedTemplate(result[0]);
      }
    } catch (err: unknown) {
      setPageError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  useEffect(() => {
    const fetchTemplateDetail = async () => {
      if (!selectedTemplate?.formType) return;

      try {
        const detail = await getJson<BackendTemplateDetail>(`/api/forms/${selectedTemplate.formType}`);
        setSelectedTemplateDetail(detail);
      } catch (err: unknown) {
        setSelectedTemplateDetail(null);
        setPageError(err instanceof Error ? err.message : "Failed to load template detail");
      }
    };

    void fetchTemplateDetail();
  }, [selectedTemplate?.formType]);

  useEffect(() => {
    const syncDraftTemplate = async () => {
      if (!currentDraft?.formType) return;
      if (selectedTemplateDetail?.formType === currentDraft.formType) return;

      try {
        const detail = await getJson<BackendTemplateDetail>(`/api/forms/${currentDraft.formType}`);
        setSelectedTemplateDetail(detail);
      } catch {
        // Leave the previous detail intact; review can still fall back to payload keys.
      }
    };

    void syncDraftTemplate();
  }, [currentDraft?.formType, selectedTemplateDetail?.formType]);

  const handleSignOut = () => {
    clearToken?.();
    onLogout();
    navigate("/");
  };

  const validationSummary = useMemo(() => flattenValidation(currentDraft?.validation), [currentDraft?.validation]);

  const stats = useMemo(
    () => [
      {
        label: "Active templates",
        value: String(templates.length)
      },
      {
        label: "Current draft",
        value: currentDraft ? currentDraft.draftId.slice(0, 8) : "None"
      },
      {
        label: "Validation issues",
        value: String(validationSummary.errors.length)
      }
    ],
    [currentDraft, templates.length, validationSummary.errors.length]
  );

  const renderCreateTab = () => {
    return (
      <div className="tab-section fade-slide-in">
        <div className="section-heading-row">
          <div>
            <h2>Document workspace</h2>
            <p>Select a template and create a draft from transcript input.</p>
          </div>
        </div>

        {templates.length === 0 ? (
          <div className="empty-state">
            <h3>No templates available</h3>
            <p>Upload a template first to enable draft creation.</p>
            <button className="modal-submit" onClick={() => setActiveTab("templates")}>
              Go to Templates
            </button>
          </div>
        ) : (
          <div className="template-list">
            {templates.map((template) => {
              const selected = selectedTemplate?.formType === template.formType;
              return (
                <button
                  type="button"
                  key={`${template.formType}-${template.version}`}
                  className={`template-card${selected ? " template-card-active" : ""}`}
                  onClick={() => {
                    setSelectedTemplate(template);
                    setStatusMessage(null);
                  }}
                >
                  <div className="template-card-top">
                    <div>
                      <div className="template-card-title">
                        {template.displayName || prettyLabel(template.formType)}
                      </div>
                      <div className="template-card-sub">{template.formType}</div>
                    </div>
                    <span className="widget-tag">v{template.version}</span>
                  </div>
                  <div className="template-card-meta">
                    {(template.templateImageUrls?.length || 0) > 0
                      ? `${template.templateImageUrls?.length} reference image(s)`
                      : "Schema-driven template"}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedTemplate && (
          <div className="selection-panel">
            <div>
              <div className="selection-title">
                {selectedTemplate.displayName || prettyLabel(selectedTemplate.formType)}
              </div>
              <div className="selection-subtitle">
                Version {selectedTemplate.version} · {selectedTemplate.formType}
              </div>
            </div>
            <button className="modal-submit" onClick={() => setShowCreateDraftModal(true)}>
              Create Draft
            </button>
          </div>
        )}

        {selectedTemplateDetail?.jsonSchema?.properties && (
          <div className="schema-preview">
            <h3>Schema Preview</h3>
            <div className="field-chip-list">
              {Object.entries(selectedTemplateDetail.jsonSchema.properties).map(([key, value]) => (
                <span key={key} className="field-chip">
                  {value.title || prettyLabel(key)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTemplatesTab = () => {
    return (
      <div className="tab-section fade-slide-in">
        <div className="section-heading-row">
          <div>
            <h2>Template library</h2>
            <p>Register new templates and inspect the currently available ones.</p>
          </div>
          <button className="modal-submit" onClick={() => setShowTemplateModal(true)}>
            Upload Template
          </button>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Display Name</th>
                <th>Form Type</th>
                <th>Version</th>
                <th>Reference Images</th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={`${template.formType}-${template.version}`}>
                  <td>{template.displayName || prettyLabel(template.formType)}</td>
                  <td>{template.formType}</td>
                  <td>v{template.version}</td>
                  <td>{template.templateImageUrls?.length || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderReviewTab = () => {
    if (!currentDraft) {
      return (
        <div className="tab-section fade-slide-in">
          <h2>Draft review</h2>
          <p>No draft is loaded yet. Create a draft from the Create tab first.</p>
        </div>
      );
    }

    return (
      <div className="tab-section fade-slide-in">
        <div className="section-heading-row">
          <div>
            <h2>Draft review</h2>
            <p>Inspect the extracted payload, resolve validation issues, and finalize when ready.</p>
          </div>
          <button className="modal-submit" onClick={() => setShowReviewModal(true)}>
            Open Editor
          </button>
        </div>

        <div className="review-grid">
          <div className="review-card">
            <div className="review-card-title">Draft Summary</div>
            <dl className="summary-list">
              <div>
                <dt>Draft ID</dt>
                <dd>{currentDraft.draftId}</dd>
              </div>
              <div>
                <dt>Form Type</dt>
                <dd>{currentDraft.formType}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{currentDraft.status}</dd>
              </div>
              <div>
                <dt>Template Version</dt>
                <dd>{currentDraft.templateVersion}</dd>
              </div>
            </dl>
          </div>

          <div className="review-card">
            <div className="review-card-title">Validation</div>
            <div className="issue-stack">
              {validationSummary.errors.length === 0 && validationSummary.warnings.length === 0 && (
                <div className="issue-line issue-line-clean">No validation issues.</div>
              )}

              {validationSummary.errors.map((issue, index) => (
                <div key={`error-${index}`} className="issue-line issue-line-error">
                  <strong>{issue.path}</strong>: {issue.message}
                </div>
              ))}

              {validationSummary.warnings.map((issue, index) => (
                <div key={`warning-${index}`} className="issue-line issue-line-warning">
                  <strong>{issue.path}</strong>: {issue.message}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="payload-preview">
          <div className="review-card-title">Payload Preview</div>
          <pre>{JSON.stringify(currentDraft.payload, null, 2)}</pre>
        </div>
      </div>
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "create":
        return renderCreateTab();
      case "templates":
        return renderTemplatesTab();
      case "review":
        return renderReviewTab();
      default:
        return null;
    }
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <div className="header-kicker">Operations Console</div>
          <h1 className="app-title">Structured Document Automation</h1>
        </div>

        <button className="top-login-button" onClick={handleSignOut}>
          Sign Out
        </button>
      </header>

      <main className="column column-center">
        <section key={activeTab} className="glass-card tab-shell">
          <div className="tabs tabs-inline">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab-button${tab.id === activeTab ? " tab-button-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="tab-panel">{renderTabContent()}</div>

          <footer className="tab-footer">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`tab-icon${tab.id === activeTab ? " tab-icon-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-icon-glyph">{tab.glyph}</span>
                <span className="tab-icon-label">{tab.label}</span>
              </button>
            ))}
          </footer>
        </section>
      </main>

      <aside className="column column-right">
        <div className="widget widget-highlight">
          <div className="widget-header">
            <span>Workspace Status</span>
            <span className="widget-tag">Live</span>
          </div>
          <div className="stats-row stats-row-vertical">
            {stats.map((stat) => (
              <div className="stat-card" key={stat.label}>
                <span className="stat-label">{stat.label}</span>
                <span className="stat-value">{stat.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="widget">
          <div className="widget-header">
            <span>Selected Template</span>
            <span className="widget-tag">Context</span>
          </div>
          <p className="widget-body">
            {selectedTemplate
              ? `${selectedTemplate.displayName || prettyLabel(selectedTemplate.formType)} · version ${selectedTemplate.version}`
              : "No template selected."}
          </p>
          {selectedTemplateDetail?.promptSpec?.rules?.length ? (
            <ul className="widget-list">
              {selectedTemplateDetail.promptSpec.rules.slice(0, 3).map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="widget">
          <div className="widget-header">
            <span>Activity</span>
            <span className="widget-tag">System</span>
          </div>
          <p className="widget-body">{busy ? "Loading workspace data..." : statusMessage || "Ready."}</p>
          {lastRunId && <p className="widget-footnote">Last finalized run: {lastRunId}</p>}
          {pageError && <div className="error-text">{pageError}</div>}
        </div>
      </aside>

      <TemplateBuilderModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onUploaded={() => {
          setStatusMessage("Template uploaded successfully.");
          void loadTemplates();
        }}
      />

      <CreateDraftModal
        isOpen={showCreateDraftModal}
        template={selectedTemplate}
        onClose={() => setShowCreateDraftModal(false)}
        onCreated={(draft) => {
          setCurrentDraft(draft);
          setActiveTab("review");
          setStatusMessage(`Draft ${draft.draftId.slice(0, 8)} created.`);
        }}
      />

      <DraftReviewModal
        isOpen={showReviewModal}
        draft={currentDraft}
        template={selectedTemplateDetail}
        onClose={() => setShowReviewModal(false)}
        onSaved={(draft) => {
          setCurrentDraft(draft);
          setStatusMessage(`Draft ${draft.draftId.slice(0, 8)} updated.`);
        }}
        onFinalized={(result) => {
          const runId =
            typeof result === "object" && result !== null && "run" in result
              ? ((result as { run?: { runId?: string } }).run?.runId ?? null)
              : null;
          setLastRunId(runId);
          setStatusMessage(runId ? `Draft finalized into run ${runId}.` : "Draft finalized.");
        }}
      />
    </div>
  );
};

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await me();
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setAuthReady(true);
      }
    };

    void bootstrap();
  }, []);

  if (!authReady) {
    return (
      <div className="login-page">
        <div className="glass-card login-card">
          <h2>Loading workspace...</h2>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          isAuthenticated ? (
            <Navigate to="/dashboard" />
          ) : (
            <Login onLogin={() => setIsAuthenticated(true)} />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          isAuthenticated ? (
            <Dashboard onLogout={() => setIsAuthenticated(false)} />
          ) : (
            <Navigate to="/" />
          )
        }
      />
    </Routes>
  );
};

export default App;
