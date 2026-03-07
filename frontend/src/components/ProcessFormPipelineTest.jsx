import React, { useEffect, useMemo, useRef, useState } from "react";

function guessDownloadUrlFromFsPath(p) {
  // If backend returns "storage/....", make it "/storage/...."
  if (!p) return "";
  const norm = p.replaceAll("\\", "/");
  const idx = norm.indexOf("/storage/");
  if (idx >= 0) return norm.slice(idx);
  if (norm.startsWith("storage/")) return "/" + norm;
  return ""; // unknown shape
}

export default function ProcessFormPipelineTest() {
  const [forms, setForms] = useState([]);
  const [selectedFormType, setSelectedFormType] = useState("");
  const [selectedForm, setSelectedForm] = useState(null);

  const [filledImageFile, setFilledImageFile] = useState(null);

  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState(null);

  const [transcriptOverride, setTranscriptOverride] = useState("");
  const [useTranscriptInsteadOfAudio, setUseTranscriptInsteadOfAudio] = useState(false);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  useEffect(() => {
    (async () => {
      setErr("");
      try {
        const res = await fetch("/api/forms");
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setForms(data);
        if (data?.length) setSelectedFormType(data[0].formType);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedFormType) return;
    (async () => {
      setErr("");
      setSelectedForm(null);
      try {
        const res = await fetch(`/api/forms/${encodeURIComponent(selectedFormType)}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setSelectedForm(data);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [selectedFormType]);

  const templateUrls = useMemo(() => {
    // Prefer templateImageUrls if you add it to the backend responses.
    const urls = selectedForm?.templateImageUrls || [];
    if (urls.length) return urls;

    // Fallback: try to derive from paths (not ideal)
    const paths = selectedForm?.templateImagePaths || [];
    return paths
      .map((p) => guessDownloadUrlFromFsPath(p))
      .filter(Boolean);
  }, [selectedForm]);

  async function startRecording() {
    setErr("");
    setResult(null);
    setAudioBlob(null);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });

    chunksRef.current = [];
    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mr.mimeType });
      setAudioBlob(blob);
      // stop mic tracks
      stream.getTracks().forEach((t) => t.stop());
    };

    mediaRecorderRef.current = mr;
    mr.start();
    setIsRecording(true);
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    mr.stop();
    setIsRecording(false);
  }

  async function runPipeline() {
    setErr("");
    setResult(null);
    setBusy(true);
    try {
      if (!selectedFormType) throw new Error("Select a formType first");

      const fd = new FormData();
      fd.append("formType", selectedFormType);

      if (useTranscriptInsteadOfAudio) {
        if (!transcriptOverride.trim()) throw new Error("Transcript is empty");
        fd.append("transcript", transcriptOverride.trim());
      } else {
        if (!audioBlob) throw new Error("Record audio first (or switch to transcript mode)");
        fd.append("audio", audioBlob, "recording.webm");
      }

      if (filledImageFile) {
        fd.append("filledFormImage", filledImageFile, filledImageFile.name);
      }

      const res = await fetch("/api/forms/process", { method: "POST", body: fd });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      const data = JSON.parse(text);

      setResult(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const pdfUrl = useMemo(() => guessDownloadUrlFromFsPath(result?.pdfPath), [result]);
  const xmlUrl = useMemo(() => guessDownloadUrlFromFsPath(result?.xmlPath), [result]);

  return (
    <div style={{ padding: 16, maxWidth: 1000, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <h2>Process Form Pipeline Test</h2>

      {err ? (
        <div style={{ padding: 12, background: "#2a0f0f", border: "1px solid #5a1f1f", marginBottom: 12 }}>
          <strong>Error:</strong> {err}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 16 }}>
        <div style={{ border: "1px solid #333", padding: 12, borderRadius: 8 }}>
          <h3>1) Select form</h3>
          <select
            value={selectedFormType}
            onChange={(e) => setSelectedFormType(e.target.value)}
            style={{ width: "100%", padding: 8 }}
          >
            {forms.map((f) => (
              <option key={`${f.formType}:${f.version}`} value={f.formType}>
                {f.displayName || f.formType} (v{f.version})
              </option>
            ))}
          </select>

          <div style={{ marginTop: 12 }}>
            <h4>Template preview</h4>
            {templateUrls.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {templateUrls.map((u) => (
                  <img key={u} src={u} alt="template" style={{ width: "100%", border: "1px solid #444" }} />
                ))}
              </div>
            ) : (
              <div style={{ opacity: 0.7 }}>No templateImageUrls returned (patch backend to include them).</div>
            )}
          </div>
        </div>

        <div style={{ border: "1px solid #333", padding: 12, borderRadius: 8 }}>
          <h3>2) Provide input</h3>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={useTranscriptInsteadOfAudio}
              onChange={(e) => setUseTranscriptInsteadOfAudio(e.target.checked)}
            />
            Use transcript instead of recording
          </label>

          {useTranscriptInsteadOfAudio ? (
            <textarea
              value={transcriptOverride}
              onChange={(e) => setTranscriptOverride(e.target.value)}
              placeholder="Paste transcript here..."
              rows={6}
              style={{ width: "100%", marginTop: 8, padding: 8 }}
            />
          ) : (
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
              {!isRecording ? (
                <button onClick={startRecording} disabled={busy}>
                  Start recording
                </button>
              ) : (
                <button onClick={stopRecording} disabled={busy}>
                  Stop recording
                </button>
              )}
              <span style={{ opacity: 0.8 }}>
                {audioBlob ? `Audio captured (${Math.round(audioBlob.size / 1024)} KB)` : "No audio yet"}
              </span>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <h3>3) Optional filled form photo</h3>
            <input type="file" accept="image/*" onChange={(e) => setFilledImageFile(e.target.files?.[0] || null)} />
          </div>

          <div style={{ marginTop: 16 }}>
            <button onClick={runPipeline} disabled={busy}>
              {busy ? "Running..." : "Run pipeline"}
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            <h3>Result</h3>
            {result ? (
              <div style={{ border: "1px solid #444", borderRadius: 8, padding: 12 }}>
                <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>

                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  {pdfUrl ? (
                    <a href={pdfUrl} target="_blank" rel="noreferrer">
                      Open PDF
                    </a>
                  ) : null}
                  {xmlUrl ? (
                    <a href={xmlUrl} target="_blank" rel="noreferrer">
                      Open XML
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <div style={{ opacity: 0.7 }}>No result yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}