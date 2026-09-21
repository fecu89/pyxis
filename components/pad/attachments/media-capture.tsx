"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleStop, Mic, Radio, Video, X } from "lucide-react";
import styles from "@/components/pad/attachments/media-capture.module.css";

export type CaptureMode = "photo" | "audio" | "video";
const defaultCaptureModes: CaptureMode[] = ["photo", "audio", "video"];

function captureFilename(prefix: string, extension: string) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  return `${prefix}_${timestamp}.${extension}`;
}

function supportedRecordingType(mode: "audio" | "video") {
  const candidates = mode === "audio"
    ? ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"]
    : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function MediaCapture({
  onCapture,
  onClose,
  modes = defaultCaptureModes,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
  modes?: CaptureMode[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  // 권한 프롬프트가 떠 있는 동안 닫거나 다른 모드를 누르면 먼저 시작한 getUserMedia가 나중에
  // 성공할 수 있습니다. 세대 번호로 늦게 도착한 스트림을 즉시 정지해 장치 트랙 누수를 막습니다.
  const streamGenerationRef = useRef(0);
  const [mode, setMode] = useState<CaptureMode | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");

  const stopStream = useCallback((updateState = true) => {
    streamGenerationRef.current += 1;
    discardRecordingRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    if (updateState) setRecording(false);
  }, []);

  useEffect(() => () => stopStream(false), [stopStream]);

  async function openMode(nextMode: CaptureMode) {
    stopStream();
    const generation = streamGenerationRef.current;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: nextMode === "audio" || nextMode === "video",
        video: nextMode === "photo" || nextMode === "video"
          ? { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
          : false,
      });
      if (generation !== streamGenerationRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      setMode(nextMode);
      if (nextMode !== "audio" && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      if (generation !== streamGenerationRef.current) return;
      stopStream();
      setMode(null);
      setError("카메라 또는 마이크를 사용할 수 없습니다. 브라우저 권한을 확인해 주세요.");
    }
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("카메라 화면이 준비될 때까지 잠시 기다려 주세요.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return setError("사진을 저장하지 못했습니다.");
      onCapture(new File([blob], captureFilename("카메라_사진", "jpg"), { type: "image/jpeg" }));
      stopStream();
      onClose();
    }, "image/jpeg", .9);
  }

  function startRecording() {
    if (!mode || mode === "photo" || !streamRef.current) return;
    const mimeType = supportedRecordingType(mode);
    try {
      const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      discardRecordingRef.current = false;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        if (discardRecordingRef.current) {
          chunksRef.current = [];
          return;
        }
        if (!chunksRef.current.length) return;
        const type = recorder.mimeType || (mode === "audio" ? "audio/webm" : "video/webm");
        const prefix = mode === "audio" ? "음성_녹음" : "영상_녹화";
        onCapture(new File([new Blob(chunksRef.current, { type })], captureFilename(prefix, "webm"), { type }));
        chunksRef.current = [];
        for (const track of streamRef.current?.getTracks() ?? []) track.stop();
        streamRef.current = null;
        setRecording(false);
        onClose();
      }, { once: true });
      recorderRef.current = recorder;
      recorder.start(500);
      setRecording(true);
    } catch {
      setError("이 브라우저에서는 선택한 형식으로 녹화할 수 없습니다.");
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      discardRecordingRef.current = false;
      recorderRef.current.stop();
    }
  }

  function close() {
    stopStream();
    onClose();
  }

  return (
    <section className={styles.root} aria-label="카메라와 녹음">
      <div className={styles.modeButtons}>
        {modes.includes("photo") && (
          <button type="button" data-active={mode === "photo"} onClick={() => openMode("photo")}><Camera size={15} />사진</button>
        )}
        {modes.includes("audio") && (
          <button type="button" data-active={mode === "audio"} onClick={() => openMode("audio")}><Mic size={15} />음성</button>
        )}
        {modes.includes("video") && (
          <button type="button" data-active={mode === "video"} onClick={() => openMode("video")}><Video size={15} />영상</button>
        )}
      </div>
      {mode && (
        <div className={styles.preview}>
          {mode === "audio"
            ? (
              <div className={styles.audioState}>
                <Radio className={recording ? styles.recording : ""} size={36} />
                <span>{recording ? "녹음 중입니다." : "마이크가 준비됐습니다."}</span>
              </div>
            )
            : <video ref={videoRef} muted playsInline aria-label="카메라 미리보기" />}
        </div>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.actions}>
        <button type="button" className="button ghost" onClick={close}><X size={15} />닫기</button>
        {mode === "photo" && <button type="button" className="button primary" onClick={takePhoto}><Camera size={15} />촬영</button>}
        {(mode === "audio" || mode === "video") && !recording && <button type="button" className="button primary" onClick={startRecording}><Radio size={15} />녹화 시작</button>}
        {recording && <button type="button" className="button danger" onClick={stopRecording}><CircleStop size={15} />녹화 종료</button>}
      </footer>
    </section>
  );
}
