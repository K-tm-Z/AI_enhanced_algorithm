import React, { useEffect, useState } from "react";
import { sendFormData } from "../../lib/api";
import type { BackendDraft, BackendTemplateSummary } from "../../types/forms";
import { prettyLabel } from "../../utils/formHelpers";
import { useVoiceRecorder } from "../../hooks/useVoiceRecorder";

function audioFilename(blob: Blob): string {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("mp4") || t.includes("aac") || t.includes("m4a")) return "recording.m4a";
  if (t.includes("webm")) return "recording.webm";
  return "recording.webm";
}

const CreateDraftModal: React.FC<{
  isOpen: boolean;
  template: BackendTemplateSummary | null;
  onClose: () => void;
  onCreated: (draft: BackendDraft) => void;
}> = ({ isOpen, template, onClose, onCreated }) => {
  const voice = useVoiceRecorder();
  const [transcript, setTranscript] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      voice.dispose();
      setTranscript("");
      setImageFile(null);
      setError(null);
      setBusy(false);
    }
  }, [isOpen, voice.dispose]);

  if (!isOpen || !template) return null;

  const handleSubmit = async () => {
    setBusy(true);
    setError(null);

    const trimmed = transcript.trim();
    if (!trimmed && !voice.blob) {
      setError("Enter a transcript or record your voice.");
      setBusy(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("formType", template.formType);
      if (trimmed) {
        formData.append("transcript", trimmed);
      } else if (voice.blob) {
        formData.append("audio", voice.blob, audioFilename(voice.blob));
      }
      if (imageFile) {
        formData.append("filledFormImage", imageFile);
      }

      const draft = await sendFormData<BackendDraft>("/api/forms/drafts", "POST", formData);
      voice.dispose();
      onCreated(draft);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Draft creation failed");
    } finally {
      setBusy(false);
    }
  };

  const combinedError = error || voice.error;
  const hasInput = Boolean(transcript.trim() || voice.blob);
  const inputHint = transcript.trim()
    ? "Using typed transcript."
    : voice.blob
      ? "Using voice recording (transcribed on save)."
      : "Type below or record voice.";

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div className="modal-header-block">
          <h2>Create draft</h2>
          <p>{template.displayName || prettyLabel(template.formType)} · v{template.version}</p>
        </div>

        <div className="modal-form">
          <div className="voice-input-section">
            <span className="modal-label voice-section-label">Voice</span>
            {!voice.canRecord ? (
              <p className="voice-hint muted">Recording not available in this browser.</p>
            ) : (
              <>
                <div className="voice-controls">
                  {!voice.isRecording ? (
                    <button
                      type="button"
                      className="secondary-button voice-btn"
                      onClick={() => void voice.startRecording()}
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
                    <span className="voice-recording-indicator" aria-live="polite">
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

          <label className="modal-label">
            Transcript{" "}
            <span className="label-hint-inline">
              (optional if you recorded — typed text wins if both are set)
            </span>
            <textarea
              rows={6}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="Paste or type what was said, or use voice above."
              disabled={busy}
            />
          </label>
          <p className="voice-input-hint muted">{inputHint}</p>

          <label className="modal-label">
            Optional filled form image
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
            />
          </label>

          {combinedError && <div className="error-text">{combinedError}</div>}
        </div>

        <div className="modal-actions">
          <button type="button" onClick={onClose} className="modal-cancel" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            className="modal-submit"
            disabled={busy || !hasInput}
          >
            {busy ? "Creating…" : "Create draft"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateDraftModal;
