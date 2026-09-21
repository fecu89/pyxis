"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { QuizScoreSoundProvider } from "@/components/quiz/live-audio-context";
import { countdownStepAt, sequenceStageAt, type QuestionSequencePayload } from "@/lib/quiz/question-sequence";
import type { QuizLiveAudioSettings, QuizLiveEffectSlot } from "@/lib/quiz/live-audio-shape";

type LiveAudioScene = "LOBBY" | "GAME" | "ENDED";

type LiveAudioControllerProps = {
  settings: QuizLiveAudioSettings;
  scene: LiveAudioScene;
  sequence: QuestionSequencePayload | null;
  quizStartSignal: number;
  leaderboardSignal: number;
  leaderboardActive: boolean;
  finishSignal: number;
  hasFinalPodium: boolean;
  children: ReactNode;
};

const QUIZ_AUDIO_MUTED_KEY = "pyxis:quiz-live-audio-muted";
const SCORE_TICK_INTERVAL_MS = 90;

function markAutoplayBlocked(error: unknown, setBlocked: (value: boolean) => void) {
  if (error instanceof DOMException && error.name === "NotAllowedError") setBlocked(true);
}

function readMutedPreference() {
  try { return window.localStorage.getItem(QUIZ_AUDIO_MUTED_KEY) === "1"; }
  catch { return false; }
}

function writeMutedPreference(muted: boolean) {
  try { window.localStorage.setItem(QUIZ_AUDIO_MUTED_KEY, muted ? "1" : "0"); }
  catch { /* 저장소가 차단돼도 현재 탭의 음소거는 그대로 동작합니다. */ }
}

export function QuizLiveAudioController({
  settings,
  scene,
  sequence,
  quizStartSignal,
  leaderboardSignal,
  leaderboardActive,
  finishSignal,
  hasFinalPodium,
  children,
}: LiveAudioControllerProps) {
  const [ready, setReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const effectsRef = useRef<Partial<Record<QuizLiveEffectSlot, HTMLAudioElement>>>({});
  const lastScoreTickRef = useRef(0);
  const seenStartRef = useRef(quizStartSignal);
  const seenLeaderboardRef = useRef(leaderboardSignal);
  const seenFinishRef = useRef(finishSignal);
  const seenCountdownRef = useRef(new Set<string>());
  const leaderboardTimerRef = useRef<number | null>(null);
  const podiumTimerRef = useRef<number | null>(null);

  const hasAnyAudio = useMemo(
    () => Object.values(settings.tracks).some(Boolean),
    [settings.tracks],
  );
  const musicTrack = scene === "LOBBY"
    ? settings.tracks.lobbyMusic
    : scene === "GAME"
      ? settings.tracks.gameMusic
      : null;

  useEffect(() => {
    // 서버/클라이언트 첫 렌더를 같게 두고 브라우저 저장값은 마운트 직후 반영합니다.
    // 타이머 안에서 갱신해 effect 본문의 동기 연쇄 렌더도 피합니다.
    const timer = window.setTimeout(() => {
      setMuted(readMutedPreference());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 장면이 바뀔 때만 Audio 객체와 소스를 교체합니다. 볼륨·음소거 변경은 같은 재생 위치를
  // 유지하므로 대기실 음악을 끄고 켤 때 매번 처음부터 다시 시작하지 않습니다.
  useEffect(() => {
    musicRef.current?.pause();
    musicRef.current = null;
    if (!musicTrack) return;
    const audio = new Audio();
    audio.loop = true;
    // 음소거·볼륨 0인 참가자도 12MB BGM을 먼저 받지 않도록 play() 시점까지 본문 로드를 미룹니다.
    audio.preload = "none";
    audio.src = musicTrack.url;
    musicRef.current = audio;
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      if (musicRef.current === audio) musicRef.current = null;
    };
  }, [musicTrack]);

  const resumeMusic = useCallback(() => {
    const audio = musicRef.current;
    if (!ready || muted || settings.musicVolume <= 0 || document.visibilityState === "hidden" || !audio) return;
    audio.volume = settings.musicVolume / 100;
    if (!audio.paused) return;
    void audio.play()
      .then(() => setBlocked(false))
      .catch((error) => markAutoplayBlocked(error, setBlocked));
  }, [muted, ready, settings.musicVolume]);

  useEffect(() => {
    const audio = musicRef.current;
    if (!audio) return;
    audio.volume = settings.musicVolume / 100;
    if (!ready || muted || settings.musicVolume <= 0 || document.visibilityState === "hidden") audio.pause();
    else resumeMusic();
  }, [musicTrack, muted, ready, resumeMusic, settings.musicVolume]);

  const playEffect = useCallback((slot: QuizLiveEffectSlot) => {
    const track = settings.tracks[slot];
    if (!ready || muted || settings.effectsVolume <= 0 || !track || document.visibilityState === "hidden") return;
    let audio = effectsRef.current[slot];
    if (!audio || audio.dataset.revision !== track.revision) {
      if (audio) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }
      audio = new Audio(track.url);
      audio.preload = "metadata";
      audio.dataset.revision = track.revision;
      effectsRef.current[slot] = audio;
    }
    audio.volume = settings.effectsVolume / 100;
    audio.currentTime = 0;
    void audio.play()
      .then(() => setBlocked(false))
      .catch((error) => markAutoplayBlocked(error, setBlocked));
  }, [muted, ready, settings.effectsVolume, settings.tracks]);

  const playScoreTick = useCallback(() => {
    const now = performance.now();
    if (now - lastScoreTickRef.current < SCORE_TICK_INTERVAL_MS) return;
    lastScoreTickRef.current = now;
    playEffect("scoreTick");
  }, [playEffect]);

  useEffect(() => {
    if (quizStartSignal === seenStartRef.current) return;
    seenStartRef.current = quizStartSignal;
    playEffect("startBell");
  }, [playEffect, quizStartSignal]);

  useEffect(() => {
    if (leaderboardSignal === seenLeaderboardRef.current) return;
    seenLeaderboardRef.current = leaderboardSignal;
    if (leaderboardTimerRef.current !== null) window.clearTimeout(leaderboardTimerRef.current);
    // 점수 카운트업(기본 900ms)이 끝난 뒤 나팔을 울려 비프음과 서로 덮이지 않게 합니다.
    leaderboardTimerRef.current = window.setTimeout(() => playEffect("podiumFanfare"), 950);
    return () => {
      if (leaderboardTimerRef.current !== null) window.clearTimeout(leaderboardTimerRef.current);
      leaderboardTimerRef.current = null;
    };
  }, [leaderboardSignal, playEffect]);

  useEffect(() => {
    if (leaderboardActive || leaderboardTimerRef.current === null) return;
    window.clearTimeout(leaderboardTimerRef.current);
    leaderboardTimerRef.current = null;
  }, [leaderboardActive]);

  useEffect(() => {
    if (finishSignal === seenFinishRef.current) return;
    seenFinishRef.current = finishSignal;
    playEffect("finishBell");
    if (!hasFinalPodium) return;
    if (podiumTimerRef.current !== null) window.clearTimeout(podiumTimerRef.current);
    podiumTimerRef.current = window.setTimeout(() => playEffect("podiumFanfare"), 1_050);
    return () => {
      if (podiumTimerRef.current !== null) window.clearTimeout(podiumTimerRef.current);
      podiumTimerRef.current = null;
    };
  }, [finishSignal, hasFinalPodium, playEffect]);

  useEffect(() => {
    if (!sequence) return;
    const announceCountdown = () => {
      const now = Date.now();
      if (sequenceStageAt(sequence, now) !== "COUNTDOWN") return;
      const step = countdownStepAt(new Date(sequence.readingStartsAt).getTime(), now);
      const key = `${sequence.questionId}:${step}`;
      if (seenCountdownRef.current.has(key)) return;
      seenCountdownRef.current.add(key);
      playEffect("countdownBeep");
    };
    announceCountdown();
    const timer = window.setInterval(announceCountdown, 50);
    return () => window.clearInterval(timer);
  }, [playEffect, sequence]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") musicRef.current?.pause();
      else resumeMusic();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [resumeMusic]);

  // 자동재생이 막힌 브라우저는 첫 사용자 입력에서 다시 시도합니다. 이미 지난 효과음은 뒤늦게
  // 재생하지 않고, 현재 장면의 배경음악만 이어서 시작합니다.
  useEffect(() => {
    const unlock = () => resumeMusic();
    document.addEventListener("pointerdown", unlock, { passive: true });
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [resumeMusic]);

  useEffect(() => () => {
    musicRef.current?.pause();
    Object.values(effectsRef.current).forEach((audio) => {
      audio?.pause();
      audio?.removeAttribute("src");
      audio?.load();
    });
    effectsRef.current = {};
    if (leaderboardTimerRef.current !== null) window.clearTimeout(leaderboardTimerRef.current);
    if (podiumTimerRef.current !== null) window.clearTimeout(podiumTimerRef.current);
  }, []);

  function toggleMuted() {
    if (blocked && !muted) {
      const audio = musicRef.current;
      setBlocked(false);
      if (audio && document.visibilityState !== "hidden") {
        audio.volume = settings.musicVolume / 100;
        void audio.play().then(() => setBlocked(false)).catch((error) => markAutoplayBlocked(error, setBlocked));
      }
      return;
    }
    const next = !muted;
    setMuted(next);
    setBlocked(false);
    writeMutedPreference(next);
    if (next) {
      musicRef.current?.pause();
      Object.values(effectsRef.current).forEach((audio) => audio?.pause());
      return;
    }
    // 클릭 이벤트가 허용한 재생 권한을 같은 호출 스택에서 사용합니다.
    const audio = musicRef.current;
    if (audio && document.visibilityState !== "hidden") {
      audio.volume = settings.musicVolume / 100;
      void audio.play().then(() => setBlocked(false)).catch((error) => markAutoplayBlocked(error, setBlocked));
    }
  }

  return (
    <QuizScoreSoundProvider play={playScoreTick}>
      {children}
      {hasAnyAudio ? (
        <button
          type="button"
          onClick={toggleMuted}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[70] inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-brand-950/85 px-4 text-xs font-black text-white shadow-xl backdrop-blur-md transition hover:bg-brand-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-info-300"
          aria-label={muted || blocked ? "라이브 퀴즈 소리 켜기" : "라이브 퀴즈 소리 끄기"}
          title={blocked ? "브라우저가 자동재생을 막았습니다. 눌러서 소리를 켜 주세요." : undefined}
        >
          {muted || blocked ? <VolumeX size={17} /> : <Volume2 size={17} />}
          <span>{muted ? "소리 켜기" : blocked ? "눌러서 소리 시작" : "소리 끄기"}</span>
        </button>
      ) : null}
    </QuizScoreSoundProvider>
  );
}
