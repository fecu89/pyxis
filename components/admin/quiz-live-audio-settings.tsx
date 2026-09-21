"use client";

import { useState, type ChangeEvent } from "react";
import { BellRing, LoaderCircle, Music2, Trash2, Upload, Volume2 } from "lucide-react";
import { useDialog } from "@/components/ui/app-dialog";
import {
  QUIZ_LIVE_AUDIO_MAX_MB,
  QUIZ_LIVE_AUDIO_SLOT_INFO,
  QUIZ_LIVE_AUDIO_SLOTS,
  type QuizLiveAudioSettings,
  type QuizLiveAudioSlot,
} from "@/lib/quiz/live-audio-shape";
import styles from "@/components/admin/quiz-live-audio-settings.module.css";

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result as QuizLiveAudioSettings;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function QuizLiveAudioSettingsPanel({ initialSettings, onAuditChanged }: { initialSettings: QuizLiveAudioSettings; onAuditChanged?: () => void }) {
  const dialog = useDialog();
  const [settings, setSettings] = useState(initialSettings);
  const [musicVolume, setMusicVolume] = useState(initialSettings.musicVolume);
  const [effectsVolume, setEffectsVolume] = useState(initialSettings.effectsVolume);
  const [pendingSlot, setPendingSlot] = useState<QuizLiveAudioSlot | null>(null);
  const [savingVolume, setSavingVolume] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const volumeDirty = Boolean(
    musicVolume !== settings.musicVolume || effectsVolume !== settings.effectsVolume
  );

  async function saveVolumes() {
    if (!volumeDirty || savingVolume) return;
    setSavingVolume(true);
    setError("");
    setMessage("");
    try {
      const next = await responseJson(await fetch("/api/admin/quiz-live-audio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicVolume, effectsVolume }),
      }));
      setSettings(next);
      setMusicVolume(next.musicVolume);
      setEffectsVolume(next.effectsVolume);
      setMessage("라이브 퀴즈 볼륨을 저장했습니다.");
      onAuditChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "볼륨을 저장하지 못했습니다.");
    } finally {
      setSavingVolume(false);
    }
  }

  async function upload(slot: QuizLiveAudioSlot, event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file || pendingSlot) return;
    if (file.size > QUIZ_LIVE_AUDIO_MAX_MB * 1024 * 1024) {
      setError(`음원은 ${QUIZ_LIVE_AUDIO_MAX_MB}MB 이하만 올릴 수 있습니다.`);
      return;
    }
    setPendingSlot(slot);
    setError("");
    setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      const next = await responseJson(await fetch(`/api/admin/quiz-live-audio/${slot}`, { method: "POST", body }));
      setSettings(next);
      setMessage(`${QUIZ_LIVE_AUDIO_SLOT_INFO[slot].label}을 저장했습니다.`);
      onAuditChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "음원을 저장하지 못했습니다.");
    } finally {
      setPendingSlot(null);
    }
  }

  async function remove(slot: QuizLiveAudioSlot) {
    if (!settings.tracks[slot] || pendingSlot) return;
    const confirmed = await dialog.confirm({
      title: `${QUIZ_LIVE_AUDIO_SLOT_INFO[slot].label}을 삭제할까요?`,
      description: "새로 여는 퀴즈에서는 즉시 재생되지 않습니다. 이미 열린 수업을 위해 제한된 교체 이력에 유예되며, 이력 상한에서 밀릴 때 로컬 파일도 자동 정리됩니다.",
      confirmLabel: "음원 삭제",
      danger: true,
    });
    if (!confirmed) return;
    setPendingSlot(slot);
    setError("");
    setMessage("");
    try {
      const next = await responseJson(await fetch(`/api/admin/quiz-live-audio/${slot}`, { method: "DELETE" }));
      setSettings(next);
      setMessage(`${QUIZ_LIVE_AUDIO_SLOT_INFO[slot].label}을 비웠습니다.`);
      onAuditChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "음원을 삭제하지 못했습니다.");
    } finally {
      setPendingSlot(null);
    }
  }

  return (
    <section className={`admin-panel ${styles.wrap}`} aria-labelledby="quiz-live-audio-title" role="tabpanel">
      <header className="admin-panel-header">
        <div>
          <span className="admin-kicker">QUIZ AUDIO</span>
          <h2 id="quiz-live-audio-title">퀴즈 사운드</h2>
          <p className={styles.intro}>대기실과 진행 중 음악을 각각 반복 재생하고, 퀴즈 단계에 맞춰 효과음을 한 번씩 재생합니다. MP3·M4A·WAV 파일을 슬롯당 {QUIZ_LIVE_AUDIO_MAX_MB}MB 이하로 올려 주세요. 100명 수업은 BGM을 96~128kbps로 압축하고 효과음은 2초 안팎으로 짧게 만들면 첫 재생 부하가 작습니다. 설정하지 않은 슬롯은 조용히 건너뜁니다.</p>
        </div>
      </header>

      <div className={`system-settings-body ${styles.body}`}>
        <div className={styles.volumes}>
          <label className={styles.volumeCard}>
            <span className={styles.volumeHeading}><span>배경음악 볼륨</span><b>{musicVolume}%</b></span>
            <input type="range" min={0} max={100} value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} disabled={savingVolume} />
          </label>
          <label className={styles.volumeCard}>
            <span className={styles.volumeHeading}><span>효과음 볼륨</span><b>{effectsVolume}%</b></span>
            <input type="range" min={0} max={100} value={effectsVolume} onChange={(event) => setEffectsVolume(Number(event.target.value))} disabled={savingVolume} />
          </label>
        </div>
        <button type="button" className="button soft" onClick={() => void saveVolumes()} disabled={!volumeDirty || savingVolume}>
          {savingVolume ? <LoaderCircle size={14} className="spin" /> : <Volume2 size={14} />}볼륨 저장
        </button>

        <div className={styles.grid}>
          {QUIZ_LIVE_AUDIO_SLOTS.map((slot) => {
            const info = QUIZ_LIVE_AUDIO_SLOT_INFO[slot];
            const track = settings.tracks[slot];
            const busy = pendingSlot === slot;
            const Icon = info.kind === "music" ? Music2 : BellRing;
            return (
              <article key={slot} className={styles.card} data-kind={info.kind}>
                <header className={styles.cardHeader}><Icon size={18} /><div><b>{info.label}</b><small>{info.description}</small></div></header>
                {track ? (
                  <div className={styles.track}>
                    <p title={track.originalName}>{track.originalName} <small>· {formatBytes(track.fileSize)}</small></p>
                    <audio key={track.url} controls preload="none" src={track.url}>오디오 미리듣기를 지원하지 않는 브라우저입니다.</audio>
                  </div>
                ) : <p className={styles.empty}>등록된 음원이 없습니다.</p>}
                <div className={styles.actions}>
                  <label className={`button soft ${styles.upload}`} aria-disabled={Boolean(pendingSlot)}>
                    {busy ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />}{track ? "교체" : "업로드"}
                    <input type="file" accept=".mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/wav" disabled={Boolean(pendingSlot)} onChange={(event) => void upload(slot, event)} />
                  </label>
                  {track ? <button type="button" className="button danger" disabled={Boolean(pendingSlot)} onClick={() => void remove(slot)}><Trash2 size={14} />삭제</button> : null}
                </div>
              </article>
            );
          })}
        </div>
        {message ? <p className={styles.message} role="status">{message}</p> : null}
        {error ? <p className={`${styles.message} ${styles.error}`} role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
