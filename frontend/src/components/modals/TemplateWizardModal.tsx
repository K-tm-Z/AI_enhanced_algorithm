import React, { useCallback, useMemo, useState } from "react";
import { authFetch, sendFormData } from "../../lib/api";
import { normalizeKey } from "../../utils/formHelpers";

type WizardField = {
  id: string;
  label: string;
  type: "string" | "number" | "date";
  required: boolean;
  key?: string;
  region?: { page: number; x: number; y: number; w: number; h: number };
};

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function assignStableKeys(fields: WizardField[]): WizardField[] {
  const used = new Set<string>();
  return fields.map((f) => {
    let k = normalizeKey(f.label);
    if (!k) k = "field";
    const base = k;
    let n = 2;
    while (used.has(k)) {
      k = `${base}_${n}`;
      n += 1;
    }
    used.add(k);
    return { ...f, key: k };
  });
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: () => void;
};

const TemplateWizardModal: React.FC<Props> = ({ isOpen, onClose, onUploaded }) => {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [formType, setFormType] = useState("");
  const [version, setVersion] = useState(1);
  const [blankFile, setBlankFile] = useState<File | null>(null);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [fieldMode, setFieldMode] = useState<"list" | "draw">("list");
  const [fields, setFields] = useState<WizardField[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);

  const reset = () => {
    setStep(0);
    setDisplayName("");
    setFormType("");
    setVersion(1);
    setBlankFile(null);
    setPreviewPages([]);
    setPageIndex(0);
    setFieldMode("list");
    setFields([]);
    setDrawStart(null);
    setDrawCurrent(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const loadPreviews = async () => {
    if (!blankFile) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("blankForm", blankFile);
      const res = await authFetch("/api/forms/templates/preview-pages", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as { pages?: string[] };
      const pages = Array.isArray(data.pages) ? data.pages : [];
      if (!pages.length) throw new Error("No pages returned from preview.");
      setPreviewPages(pages);
      setPageIndex(0);
      setStep(1);
      setFields([
        { id: newId(), label: "", type: "string", required: true },
        { id: newId(), label: "", type: "string", required: false },
      ]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load form preview.");
    } finally {
      setBusy(false);
    }
  };

  const addListField = () => {
    setFields((f) => [...f, { id: newId(), label: "", type: "string", required: false }]);
  };

  const updateField = (id: string, patch: Partial<WizardField>) => {
    setFields((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeField = (id: string) => {
    setFields((rows) => rows.filter((r) => r.id !== id));
  };

  const getImgCoords = useCallback(
    (clientX: number, clientY: number) => {
      const el = imgRef.current;
      if (!el || !el.naturalWidth) return null;
      const rect = el.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * el.naturalWidth;
      const y = ((clientY - rect.top) / rect.height) * el.naturalHeight;
      return { x, y, nw: el.naturalWidth, nh: el.naturalHeight };
    },
    [],
  );

  const onImageMouseDown = (e: React.MouseEvent) => {
    if (fieldMode !== "draw") return;
    const p = getImgCoords(e.clientX, e.clientY);
    if (!p) return;
    setDrawStart({ x: p.x, y: p.y });
    setDrawCurrent({ x: p.x, y: p.y });
  };

  const onImageMouseMove = (e: React.MouseEvent) => {
    if (!drawStart || fieldMode !== "draw") return;
    const p = getImgCoords(e.clientX, e.clientY);
    if (!p) return;
    setDrawCurrent({ x: p.x, y: p.y });
  };

  const onImageMouseUp = () => {
    if (!drawStart || !drawCurrent || fieldMode !== "draw") return;
    const x1 = Math.min(drawStart.x, drawCurrent.x);
    const y1 = Math.min(drawStart.y, drawCurrent.y);
    const x2 = Math.max(drawStart.x, drawCurrent.x);
    const y2 = Math.max(drawStart.y, drawCurrent.y);
    const w = x2 - x1;
    const h = y2 - y1;
    setDrawStart(null);
    setDrawCurrent(null);
    const el = imgRef.current;
    if (!el?.naturalWidth || w < 8 || h < 8) return;
    const label = window.prompt("What is this field called?", "");
    if (!label || !label.trim()) return;
    const nw = el.naturalWidth;
    const nh = el.naturalHeight;
    setFields((rows) => [
      ...rows,
      {
        id: newId(),
        label: label.trim(),
        type: "string",
        required: false,
        region: {
          page: pageIndex,
          x: x1 / nw,
          y: y1 / nh,
          w: w / nw,
          h: h / nh,
        },
      },
    ]);
  };

  const overlayRect = useMemo(() => {
    if (!drawStart || !drawCurrent || !imgRef.current?.naturalWidth) return null;
    const el = imgRef.current;
    const nw = el.naturalWidth;
    const nh = el.naturalHeight;
    const x1 = Math.min(drawStart.x, drawCurrent.x);
    const y1 = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);
    const rw = el.getBoundingClientRect().width;
    const rh = el.getBoundingClientRect().height;
    return {
      left: (x1 / nw) * rw,
      top: (y1 / nh) * rh,
      width: (w / nw) * rw,
      height: (h / nh) * rh,
    };
  }, [drawStart, drawCurrent]);

  const validFields = useMemo(
    () => fields.filter((f) => f.label.trim().length > 0),
    [fields],
  );

  const canStep1Next = displayName.trim().length > 0 && blankFile !== null;
  const canStep2Next = validFields.length > 0;

  const submitWizard = async () => {
    if (!blankFile || validFields.length === 0) return;
    const keyed = assignStableKeys(validFields);
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("blankForm", blankFile);
      fd.append("displayName", displayName.trim());
      fd.append("formType", formType.trim());
      fd.append("version", String(version));
      fd.append(
        "fieldsJson",
        JSON.stringify(
          keyed.map((f) => ({
            label: f.label.trim(),
            type: f.type,
            required: f.required,
            key: f.key,
          })),
        ),
      );
      const regions = keyed
        .filter((f) => f.region)
        .map((f) => ({
          page: f.region!.page,
          x: f.region!.x,
          y: f.region!.y,
          w: f.region!.w,
          h: f.region!.h,
          label: f.label.trim(),
          key: f.key,
        }));
      fd.append("fieldRegionsJson", JSON.stringify(regions));
      await sendFormData("/api/forms/templates/wizard", "POST", fd);
      reset();
      onUploaded();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-card modal-card-wide template-wizard-modal">
        <div className="modal-header-block">
          <h2>New form template</h2>
          <p>
            Upload a blank PDF or photo, then name each field. No JSON or technical IDs required—we
            build the schema for you.
          </p>
          <div className="wizard-step-dots">
            {["Upload", "Fields", "Review"].map((label, i) => (
              <span
                key={label}
                className={`wizard-step-dot${i === step ? " wizard-step-dot-active" : ""}${i < step ? " wizard-step-dot-done" : ""}`}
              >
                {i + 1}. {label}
              </span>
            ))}
          </div>
        </div>

        {error && <div className="error-text wizard-error">{error}</div>}

        {step === 0 && (
          <div className="modal-form wizard-form">
            <label className="modal-label">
              Form name <span className="label-hint">(shown to staff)</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Guest intake"
              />
            </label>
            <label className="modal-label">
              Internal ID <span className="label-hint">(optional — auto from name)</span>
              <input
                value={formType}
                onChange={(e) => setFormType(normalizeKey(e.target.value))}
                placeholder="e.g. guest_intake"
              />
            </label>
            <label className="modal-label">
              Version
              <input
                type="number"
                min={1}
                value={version}
                onChange={(e) => setVersion(Number(e.target.value) || 1)}
              />
            </label>
            <label className="modal-label">
              Blank form <span className="label-hint">PDF or image</span>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => setBlankFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {blankFile && (
              <p className="wizard-file-pill">
                {blankFile.name} ({Math.round(blankFile.size / 1024)} KB)
              </p>
            )}
          </div>
        )}

        {step === 1 && previewPages.length > 0 && (
          <div className="wizard-fields-layout">
            <div className="wizard-mode-toggle">
              <button
                type="button"
                className={fieldMode === "list" ? "tab-button tab-button-active" : "tab-button"}
                onClick={() => setFieldMode("list")}
              >
                Simple list
              </button>
              <button
                type="button"
                className={fieldMode === "draw" ? "tab-button tab-button-active" : "tab-button"}
                onClick={() => setFieldMode("draw")}
              >
                Mark on form
              </button>
            </div>

            {previewPages.length > 1 && (
              <div className="wizard-page-tabs">
                {previewPages.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={i === pageIndex ? "wizard-page-tab wizard-page-tab-active" : "wizard-page-tab"}
                    onClick={() => setPageIndex(i)}
                  >
                    Page {i + 1}
                  </button>
                ))}
              </div>
            )}

            <div className="wizard-split">
              <div className="wizard-canvas-column">
                <p className="wizard-hint">
                  {fieldMode === "list"
                    ? "Use the list on the right to name fields in order (e.g. Field 1: Full name)."
                    : "Click and drag on the form to draw a box, then enter the field name."}
                </p>
                <div className="wizard-image-shell">
                  <img
                    ref={imgRef}
                    src={previewPages[pageIndex]}
                    alt={`Form page ${pageIndex + 1}`}
                    className={`wizard-preview-img${fieldMode === "draw" ? " wizard-preview-img-draw" : ""}`}
                    onMouseDown={onImageMouseDown}
                    onMouseMove={onImageMouseMove}
                    onMouseUp={onImageMouseUp}
                    onMouseLeave={() => {
                      setDrawStart(null);
                      setDrawCurrent(null);
                    }}
                    draggable={false}
                  />
                  {fields
                    .filter((f) => f.region?.page === pageIndex)
                    .map((f) => (
                      <div
                        key={f.id}
                        className="wizard-saved-rect"
                        title={f.label || "Field"}
                        style={{
                          left: `${(f.region!.x * 100).toFixed(3)}%`,
                          top: `${(f.region!.y * 100).toFixed(3)}%`,
                          width: `${(f.region!.w * 100).toFixed(3)}%`,
                          height: `${(f.region!.h * 100).toFixed(3)}%`,
                        }}
                      />
                    ))}
                  {overlayRect && fieldMode === "draw" && (
                    <div
                      className="wizard-draw-rect"
                      style={{
                        left: overlayRect.left,
                        top: overlayRect.top,
                        width: overlayRect.width,
                        height: overlayRect.height,
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="wizard-list-column">
                <div className="builder-header">
                  <h3>Fields to extract</h3>
                  <button type="button" className="secondary-button" onClick={addListField}>
                    Add field
                  </button>
                </div>
                <div className="wizard-field-rows">
                  {fields.map((f, idx) => (
                    <div key={f.id} className="wizard-field-row">
                      <span className="wizard-field-num">{idx + 1}</span>
                      <input
                        placeholder="Field name (e.g. Date of birth)"
                        value={f.label}
                        onChange={(e) => updateField(f.id, { label: e.target.value })}
                      />
                      <select
                        value={f.type}
                        onChange={(e) =>
                          updateField(f.id, { type: e.target.value as WizardField["type"] })
                        }
                      >
                        <option value="string">Text</option>
                        <option value="number">Number</option>
                        <option value="date">Date</option>
                      </select>
                      <label className="checkbox-inline wizard-req">
                        <input
                          type="checkbox"
                          checked={f.required}
                          onChange={(e) => updateField(f.id, { required: e.target.checked })}
                        />
                        Required
                      </label>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => removeField(f.id)}
                        disabled={false}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-review">
            <h3>Ready to save</h3>
            <ul className="wizard-review-list">
              <li>
                <strong>Name:</strong> {displayName.trim()}
              </li>
              <li>
                <strong>Internal ID:</strong> {formType.trim() || "(auto)"}
              </li>
              <li>
                <strong>Version:</strong> {version}
              </li>
              <li>
                <strong>Fields ({validFields.length}):</strong>
                <ul>
                  {validFields.map((f) => (
                    <li key={f.id}>
                      {f.label}
                      {f.required ? " (required)" : ""} — {f.type}
                      {f.region ? " · marked on form" : ""}
                    </li>
                  ))}
                </ul>
              </li>
            </ul>
          </div>
        )}

        <div className="modal-actions wizard-actions">
          <button type="button" onClick={handleClose} className="modal-cancel" disabled={busy}>
            Cancel
          </button>
          {step === 0 && (
            <button
              type="button"
              className="modal-submit"
              disabled={!canStep1Next || busy}
              onClick={() => void loadPreviews()}
            >
              {busy ? "Loading preview…" : "Continue"}
            </button>
          )}
          {step === 1 && (
            <>
              <button type="button" className="modal-cancel" onClick={() => setStep(0)} disabled={busy}>
                Back
              </button>
              <button
                type="button"
                className="modal-submit"
                disabled={!canStep2Next || busy}
                onClick={() => setStep(2)}
              >
                Review
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button type="button" className="modal-cancel" onClick={() => setStep(1)} disabled={busy}>
                Back
              </button>
              <button type="button" className="modal-submit" disabled={busy} onClick={() => void submitWizard()}>
                {busy ? "Saving…" : "Save template"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default TemplateWizardModal;
