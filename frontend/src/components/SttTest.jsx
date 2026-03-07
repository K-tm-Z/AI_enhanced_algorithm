// src/pages/SttTest.jsx
import React, { useMemo, useRef, useState } from "react";

export default function SttTest() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const canRecord = useMemo(() => !!navigator.mediaDevices?.getUserMedia, []);

  async function start() {
    setTranscript("");
    setStatus("");
    setAudioUrl("");
    chunksRef.current = [];

    if (!canRecord) {
      setStatus("Recording not supported in this browser.");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = () => {
      // Stop tracks
      stream.getTracks().forEach((t) => t.stop());

      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    };

    mediaRecorderRef.current = mr;
    mr.start();
    setIsRecording(true);
    setStatus("Recording...");
  }

  function stop() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    setIsRecording(false);
    setStatus("Recorded. Ready to transcribe.");
  }

  async function transcribe() {
    setStatus("Uploading + transcribing...");
    setTranscript("");

    // Rebuild blob from chunks
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const form = new FormData();
    form.append("audio", blob, "test.webm");
    form.append("segmentType", "test");

    // Use /api/stt/transcribe-dev during dev, or /api/stt/transcribe once JWT is enforced
    const res = await fetch("/api/stt/transcribe", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      setStatus(`Error: ${res.status}`);
      setTranscript(text);
      return;
    }

    const data = await res.json();
    setTranscript(data.transcript || "");
    setStatus("Done.");
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h2>STT Test</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={start} disabled={isRecording}>Start</button>
        <button onClick={stop} disabled={!isRecording}>Stop</button>
        <button onClick={transcribe} disabled={isRecording || chunksRef.current.length === 0}>
          Transcribe
        </button>
      </div>

      <div style={{ marginBottom: 12, opacity: 0.8 }}>{status}</div>

      {audioUrl && (
        <div style={{ marginBottom: 12 }}>
          <audio controls src={audioUrl} />
        </div>
      )}

      <textarea
        value={transcript}
        readOnly
        placeholder="Transcript will appear here..."
        style={{ width: "100%", height: 200 }}
      />
    </div>
  );
}