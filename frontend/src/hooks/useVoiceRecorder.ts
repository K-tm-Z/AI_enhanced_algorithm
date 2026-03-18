import { useCallback, useEffect, useRef, useState } from "react";

function pickRecorderMimeType(): { mimeType: string; extension: string } {
  const candidates = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm", ext: "webm" },
    { mime: "audio/mp4", ext: "m4a" },
  ];
  for (const { mime, ext } of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(mime)) {
      return { mimeType: mime, extension: ext };
    }
  }
  return { mimeType: "", extension: "webm" };
}

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const revokePreview = useCallback(() => {
    const u = previewUrlRef.current;
    if (u) URL.revokeObjectURL(u);
    previewUrlRef.current = null;
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const clearRecording = useCallback(() => {
    revokePreview();
    setPreviewUrl(null);
    setBlob(null);
    chunksRef.current = [];
    setError(null);
  }, [revokePreview]);

  const startRecording = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone is not supported in this browser.");
      return;
    }
    clearRecording();
    const { mimeType } = pickRecorderMimeType();
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const options = mimeType ? { mimeType } : undefined;
      const mr = new MediaRecorder(stream, options);

      mr.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        stopTracks();
        const type = mr.mimeType || mimeType || "audio/webm";
        const b = new Blob(chunksRef.current, { type });
        setBlob(b);
        const url = URL.createObjectURL(b);
        revokePreview();
        previewUrlRef.current = url;
        setPreviewUrl(url);
        chunksRef.current = [];
      };

      mr.onerror = () => {
        setError("Recording failed.");
        stopTracks();
        setIsRecording(false);
      };

      mediaRecorderRef.current = mr;
      mr.start(250);
      setIsRecording(true);
    } catch (e: unknown) {
      stopTracks();
      const msg = e instanceof Error ? e.message : "Could not access microphone.";
      setError(msg.includes("Permission") ? "Microphone permission denied." : msg);
    }
  }, [clearRecording, revokePreview, stopTracks]);

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.stop();
    }
    mediaRecorderRef.current = null;
    setIsRecording(false);
  }, []);

  const dispose = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.onstop = () => stopTracks();
      mr.ondataavailable = null;
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null;
    stopTracks();
    revokePreview();
    setPreviewUrl(null);
    setBlob(null);
    chunksRef.current = [];
    setIsRecording(false);
    setError(null);
  }, [revokePreview, stopTracks]);

  useEffect(() => {
    return () => {
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") {
        try {
          mr.onstop = () => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          };
          mr.stop();
        } catch {
          /* ignore */
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const u = previewUrlRef.current;
      if (u) URL.revokeObjectURL(u);
      previewUrlRef.current = null;
    };
  }, []);

  return {
    isRecording,
    error: error,
    blob,
    previewUrl,
    startRecording,
    stopRecording,
    clearRecording,
    dispose,
    canRecord: typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia,
  };
}
