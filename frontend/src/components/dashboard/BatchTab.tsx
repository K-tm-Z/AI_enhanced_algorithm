import React, { useEffect, useMemo, useRef, useState } from "react";
import type { BackendDraft, BackendTemplateDetail, BackendTemplateSummary } from "../../types/forms";
import { getJson, sendDelete, sendFormData, sendJson } from "../../lib/api";
import { prettyLabel } from "../../utils/formHelpers";
import { useVoiceRecorder } from "../../hooks/useVoiceRecorder";
import DraftReviewModal from "../modals/DraftReviewModal";

function audioFilename(blob: Blob): string {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("mp4") || t.includes("aac") || t.includes("m4a")) return "batch-recording.m4a";
  if (t.includes("webm")) return "batch-recording.webm";
  return "batch-recording.webm";
}

type BatchSlot = {
  draft: BackendDraft;
  selectedFormType: string;
  filledFile: File | null;
  busy: boolean;
  error: string | null;
  extractionConfirmed: boolean;
};

export default function BatchTab() {
  const voice = useVoiceRecorder();
  const [templates, setTemplates] = useState<BackendTemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [pastedTranscript, setPastedTranscript] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [rawTranscript, setRawTranscript] = useState<string>("");
  const [slots, setSlots] = useState<BatchSlot[]>([]);

  const [finalizeResult, setFinalizeResult] = useState<unknown>(null);
  const [humanReviewedErrors, setHumanReviewedErrors] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorSlotIndex, setEditorSlotIndex] = useState<number | null>(null);
  const templateCacheRef = useRef<Record<string, BackendTemplateDetail | null>>({});
  const [editorTemplate, setEditorTemplate] = useState<BackendTemplateDetail | null>(null);

  useEffect(() => {
    (async () => {
      setPageError(null);
      try {
        const tpls = await getJson<BackendTemplateSummary[]>("/api/forms");
        setTemplates(Array.isArray(tpls) ? tpls : []);
      } catch (e: unknown) {
        setPageError(e instanceof Error ? e.message : "Failed to load templates");
      }
    })();
  }, []);

  const pastedTrim = pastedTranscript.trim();
  const hasBatchInput = Boolean(pastedTrim || voice.blob || audioFile);

  const canFinalize = useMemo(() => {
    if (!batchId || slots.length === 0) return false;
    return slots.every((s) => {
      const templateOk = s.draft.formType === s.selectedFormType;
      return templateOk && s.extractionConfirmed;
    });
  }, [batchId, slots]);

  const slotValidationCounts = useMemo(() => {
    return slots.map((s) => {
      const errors = s.draft.validation?.errors?.length ?? 0;
      const warnings = s.draft.validation?.warnings?.length ?? 0;
      return { errors, warnings };
    });
  }, [slots]);

  const hasAnyErrors = useMemo(() => slotValidationCounts.some((c) => c.errors > 0), [slotValidationCounts]);
  const requiresHumanConfirm = hasAnyErrors;

  const getTemplateDetail = async (formType: string) => {
    if (templateCacheRef.current[formType] !== undefined) return templateCacheRef.current[formType];
    const detail = await getJson<BackendTemplateDetail>(`/api/forms/${encodeURIComponent(formType)}`);
    templateCacheRef.current[formType] = detail;
    return detail;
  };

  const applyBatchResponse = (res: {
    batchId: string;
    rawTranscript: string;
    drafts: BackendDraft[];
  }) => {
    setBatchId(res.batchId);
    setRawTranscript(res.rawTranscript || "");
    const newSlots: BatchSlot[] = (res.drafts || []).map((d) => ({
      draft: d,
      selectedFormType: d.formType,
      filledFile: null,
      busy: false,
      error: null,
      extractionConfirmed: true,
    }));
    setSlots(newSlots);
    setHumanReviewedErrors(false);
    voice.dispose();
    setAudioFile(null);
    setPastedTranscript("");
  };

  const handleSegment = async () => {
    if (!hasBatchInput) {
      setPageError("Paste a transcript, record voice, or choose an audio file.");
      return;
    }
    setBusy(true);
    setPageError(null);
    setFinalizeResult(null);
    try {
      if (pastedTrim) {
        const fd = new FormData();
        fd.append("transcript", pastedTrim);
        const res = await sendFormData<{ batchId: string; rawTranscript: string; drafts: BackendDraft[] }>(
          "/api/stt/batches/from-transcript",
          "POST",
          fd,
        );
        applyBatchResponse(res);
      } else if (voice.blob) {
        const fd = new FormData();
        fd.append("audio", voice.blob, audioFilename(voice.blob));
        const res = await sendFormData<{ batchId: string; rawTranscript: string; drafts: BackendDraft[] }>(
          "/api/stt/batches/from-audio",
          "POST",
          fd,
        );
        applyBatchResponse(res);
      } else if (audioFile) {
        const fd = new FormData();
        fd.append("audio", audioFile, audioFile.name);
        const res = await sendFormData<{ batchId: string; rawTranscript: string; drafts: BackendDraft[] }>(
          "/api/stt/batches/from-audio",
          "POST",
          fd,
        );
        applyBatchResponse(res);
      }
    } catch (e: unknown) {
      setPageError(e instanceof Error ? e.message : "Segmentation failed");
    } finally {
      setBusy(false);
    }
  };

  const handleReextractSlot = async (slotIndex: number) => {
    const slot = slots[slotIndex];
    if (!slot) return;
    if (!slot.draft?.draftId) return;
    if (!slot.selectedFormType) {
      setSlots((prev) =>
        prev.map((s, i) => (i === slotIndex ? { ...s, error: "Select a template for this slot." } : s)),
      );
      return;
    }

    setSlots((prev) => prev.map((s, i) => (i === slotIndex ? { ...s, busy: true, error: null } : s)));
    try {
      if (!(slot.draft.transcript || "").trim()) {
        setSlots((prev) =>
          prev.map((s, i) =>
            i === slotIndex ? { ...s, error: "Missing transcript for this slot.", busy: false } : s,
          ),
        );
        return;
      }

      const fd = new FormData();
      fd.append("transcript", slot.draft.transcript || "");
      fd.append("formType", slot.selectedFormType);
      if (slot.filledFile) {
        fd.append("filledFormImage", slot.filledFile, slot.filledFile.name);
      }

      const updated = await sendFormData<BackendDraft>(
        `/api/forms/drafts/${slot.draft.draftId}/reextract`,
        "POST",
        fd,
      );

      setSlots((prev) =>
        prev.map((s, i) =>
          i === slotIndex
            ? {
                ...s,
                draft: updated,
                error: null,
                busy: false,
                extractionConfirmed: true,
              }
            : s,
        ),
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Re-extraction failed";
      setSlots((prev) => prev.map((s, i) => (i === slotIndex ? { ...s, error: msg, busy: false } : s)));
    }
  };

  const openEditorForSlot = async (slotIndex: number) => {
    const slot = slots[slotIndex];
    if (!slot) return;
    setEditorSlotIndex(slotIndex);
    setEditorOpen(true);
    setEditorTemplate(null);
    const formType = slot.selectedFormType || slot.draft.formType;
    try {
      const tpl = await getTemplateDetail(formType);
      setEditorTemplate(tpl);
    } catch {
      setEditorTemplate(null);
    }
  };

  const handleCancelDraft = async (slotIndex: number) => {
    const slot = slots[slotIndex];
    if (!slot?.draft?.draftId) return;
    if (
      !window.confirm(
        "Cancel this slot? It will be removed from the batch and will not be finalized.",
      )
    ) {
      return;
    }
    setSlots((prev) => prev.map((s, i) => (i === slotIndex ? { ...s, busy: true, error: null } : s)));
    try {
      await sendDelete(`/api/forms/drafts/${encodeURIComponent(slot.draft.draftId)}`);
      setSlots((prev) => prev.filter((_, i) => i !== slotIndex));
      if (editorSlotIndex === slotIndex) {
        setEditorOpen(false);
        setEditorSlotIndex(null);
      } else if (editorSlotIndex !== null && editorSlotIndex > slotIndex) {
        setEditorSlotIndex(editorSlotIndex - 1);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not cancel draft";
      setSlots((prev) => prev.map((s, i) => (i === slotIndex ? { ...s, busy: false, error: msg } : s)));
    }
  };

  const editorDraft = editorSlotIndex === null ? null : slots[editorSlotIndex]?.draft ?? null;

  const finalizeBatch = async () => {
    if (!batchId) return;
    if (requiresHumanConfirm && !humanReviewedErrors) {
      setPageError('Batch has validation errors. Check "I reviewed flagged errors" to finalize.');
      return;
    }
    setBusy(true);
    setPageError(null);
    setFinalizeResult(null);
    try {
      const res = await sendJson(`/api/forms/batches/${batchId}/finalize`, "POST");
      setFinalizeResult(res);
    } catch (e: unknown) {
      setPageError(e instanceof Error ? e.message : "Finalize failed");
    } finally {
      setBusy(false);
    }
  };

  const resetBatch = () => {
    voice.dispose();
    setBatchId(null);
    setSlots([]);
    setRawTranscript("");
    setAudioFile(null);
    setPastedTranscript("");
    setFinalizeResult(null);
    setHumanReviewedErrors(false);
    setPageError(null);
  };

  const batchSourceHint = pastedTrim
    ? "Will segment from pasted text."
    : voice.blob
      ? "Will transcribe recording, then segment."
      : audioFile
        ? `Will transcribe file: ${audioFile.name}`
        : "Choose one input below.";

  return (
    <div className="tab-section fade-slide-in">
      <div className="section-heading-row">
        <div>
          <h2>Batch workspace</h2>
          <p>
            One long transcript or recording → multiple form slots. Paste text, record voice, or upload audio; then map
            each slot to a template and filled form.
          </p>
        </div>
      </div>

      {pageError ? <div className="batch-page-error">{pageError}</div> : null}

      <div className="batch-grid">
        <div className="batch-panel batch-panel-left">
          <h3>1) Batch input</h3>
          <p className="batch-source-hint muted">{batchSourceHint}</p>
          <p className="label-hint-inline batch-priority-hint">
            Priority: pasted text → voice recording → audio file (only one is used).
          </p>

          <label className="modal-label batch-label">
            Full transcript <span className="label-hint-inline">(optional if using audio)</span>
            <textarea
              className="batch-transcript-area"
              rows={5}
              value={pastedTranscript}
              onChange={(e) => {
                setPastedTranscript(e.target.value);
                if (e.target.value.trim()) {
                  setAudioFile(null);
                  voice.clearRecording();
                }
              }}
              placeholder="Paste the full multi-form conversation or notes here to skip STT…"
              disabled={busy}
            />
          </label>

          <div className="voice-input-section batch-voice-block">
            <span className="modal-label voice-section-label">Voice recording</span>
            {!voice.canRecord ? (
              <p className="voice-hint muted">Microphone not available in this browser.</p>
            ) : (
              <>
                <div className="voice-controls">
                  {!voice.isRecording ? (
                    <button
                      type="button"
                      className="secondary-button voice-btn"
                      onClick={() => {
                        setPastedTranscript("");
                        void voice.startRecording();
                      }}
                      disabled={busy}
                    >
                      Record
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="modal-submit voice-btn voice-btn-stop"
                      onClick={voice.stopRecording}
                      disabled={busy}
                    >
                      Stop
                    </button>
                  )}
                  {voice.isRecording && (
                    <span className="voice-recording-indicator">
                      <span className="voice-rec-dot" /> Recording…
                    </span>
                  )}
                  {voice.blob && !voice.isRecording && (
                    <button
                      type="button"
                      className="ghost-button voice-btn"
                      onClick={voice.clearRecording}
                      disabled={busy}
                    >
                      Discard recording
                    </button>
                  )}
                </div>
                {voice.previewUrl && !voice.isRecording && (
                  <audio className="voice-preview-audio" controls src={voice.previewUrl} />
                )}
              </>
            )}
          </div>

          <label className="modal-label batch-label">
            Or audio file
            <input
              type="file"
              accept="audio/*"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setAudioFile(f);
                if (f) {
                  setPastedTranscript("");
                  voice.clearRecording();
                }
              }}
            />
          </label>

          {voice.error ? <div className="error-text">{voice.error}</div> : null}

          <div className="batch-actions-row">
            <button className="modal-submit" onClick={() => void handleSegment()} disabled={busy || !hasBatchInput}>
              {busy ? "Working…" : "Segment into form slots"}
            </button>
            {batchId ? (
              <button type="button" className="secondary-button" onClick={resetBatch} disabled={busy}>
                New batch
              </button>
            ) : null}
          </div>

          {batchId ? (
            <div className="batch-meta">
              <div>
                <b>Batch ID:</b> <code>{batchId}</code>
              </div>
              <div className="muted batch-slots-count">
                Slots: <b>{slots.length}</b>
              </div>
            </div>
          ) : null}

          {batchId ? (
            <div className="batch-finalize-block">
              <h3>5) Finalize</h3>
              {requiresHumanConfirm ? (
                <label className="batch-checkbox-row">
                  <input
                    type="checkbox"
                    checked={humanReviewedErrors}
                    onChange={(e) => setHumanReviewedErrors(e.target.checked)}
                  />
                  <span>I reviewed flagged errors (one or more slots have errors)</span>
                </label>
              ) : null}
              <button className="modal-submit" onClick={() => void finalizeBatch()} disabled={busy || !canFinalize}>
                {busy ? "Finalizing…" : "Finalize batch"}
              </button>
              {finalizeResult ? (
                <pre className="batch-finalize-pre">{JSON.stringify(finalizeResult, null, 2)}</pre>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="batch-panel batch-panel-right">
          <h3>2) Slots</h3>
          {batchId && slots.length === 0 ? <div>Waiting for slots…</div> : null}

          {slots.map((slot, idx) => {
            const isReady = slot.extractionConfirmed && slot.draft.formType === slot.selectedFormType;
            const counts = slotValidationCounts[idx] ?? { errors: 0, warnings: 0 };
            return (
              <div key={slot.draft.draftId} className={`batch-slot-card${isReady ? " batch-slot-ready" : ""}`}>
                <div className="batch-slot-header">
                  <div>
                    <b>Slot {idx + 1}</b>{" "}
                    <small className="muted">draft {slot.draft.draftId.slice(0, 8)}</small>
                  </div>
                  <small className="muted">
                    {isReady
                      ? "Ready to finalize"
                      : "Change template? Run re-extract to sync before finalize."}
                  </small>
                </div>

                <div className="batch-slot-validation">
                  <b>Validation:</b>{" "}
                  <span className={counts.errors > 0 ? "batch-val-err" : ""}>Errors {counts.errors}</span>
                  {" · "}
                  <span className={counts.warnings > 0 ? "batch-val-warn" : ""}>Warnings {counts.warnings}</span>
                </div>

                <div className="batch-slot-grid">
                  <label className="batch-field-label">
                    <span>Template for this slot</span>
                    <select
                      value={slot.selectedFormType}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSlots((prev) =>
                          prev.map((s, i) => {
                            if (i !== idx) return s;
                            const matchesDraft = v === s.draft.formType;
                            return {
                              ...s,
                              selectedFormType: v,
                              error: null,
                              extractionConfirmed: matchesDraft,
                            };
                          }),
                        );
                      }}
                    >
                      {templates.map((t) => (
                        <option key={`${t.formType}:${t.version}`} value={t.formType}>
                          {t.displayName || prettyLabel(t.formType)} · v{t.version}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="batch-field-label">
                    <span>Filled form (optional — PDF or image)</span>
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, filledFile: f, error: null } : s)));
                      }}
                    />
                  </label>
                </div>

                <div className="batch-slot-actions">
                  <button
                    className="modal-submit"
                    disabled={slot.busy}
                    onClick={() => void handleReextractSlot(idx)}
                  >
                    {slot.busy ? "Re-extracting…" : "Extract / re-extract"}
                  </button>
                  <button
                    type="button"
                    disabled={slot.busy}
                    onClick={() => void openEditorForSlot(idx)}
                    className="secondary-button batch-editor-btn"
                    title="Edit extracted fields (filled form upload not required)"
                  >
                    Open editor
                  </button>
                  <button
                    type="button"
                    disabled={slot.busy}
                    onClick={() => void handleCancelDraft(idx)}
                    className="ghost-button batch-cancel-btn"
                    title="Remove this slot from the batch"
                  >
                    Cancel slot
                  </button>
                  {slot.error ? <span className="batch-slot-err">{slot.error}</span> : null}
                </div>

                <details className="batch-slot-details">
                  <summary>Payload preview (read-only)</summary>
                  <pre>{JSON.stringify(slot.draft.payload || {}, null, 2)}</pre>
                </details>
              </div>
            );
          })}

          {batchId ? (
            <details className="batch-raw-details">
              <summary>Raw segmented transcript (debug)</summary>
              <pre>{rawTranscript}</pre>
            </details>
          ) : null}
        </div>
      </div>

      <DraftReviewModal
        isOpen={editorOpen}
        draft={editorDraft}
        template={editorTemplate}
        onClose={() => {
          setEditorOpen(false);
          setEditorSlotIndex(null);
        }}
        onSaved={(updatedDraft) => {
          if (editorSlotIndex === null) return;
          setSlots((prev) => prev.map((s, i) => (i === editorSlotIndex ? { ...s, draft: updatedDraft } : s)));
        }}
        onFinalized={() => {
          setEditorOpen(false);
        }}
      />
    </div>
  );
}
