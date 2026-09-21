export const QUIZ_LIVE_AUDIO_SLOTS = [
  "lobbyMusic",
  "gameMusic",
  "startBell",
  "countdownBeep",
  "scoreTick",
  "finishBell",
  "podiumFanfare",
] as const;

export const QUIZ_LIVE_AUDIO_MAX_MB = 12;

export type QuizLiveAudioSlot = typeof QUIZ_LIVE_AUDIO_SLOTS[number];
export type QuizLiveMusicSlot = Extract<QuizLiveAudioSlot, "lobbyMusic" | "gameMusic">;
export type QuizLiveEffectSlot = Exclude<QuizLiveAudioSlot, QuizLiveMusicSlot>;

export type QuizLiveAudioTrack = {
  originalName: string;
  mimeType: string;
  fileSize: number;
  revision: string;
  url: string;
};

export type QuizLiveAudioSettings = {
  musicVolume: number;
  effectsVolume: number;
  tracks: Record<QuizLiveAudioSlot, QuizLiveAudioTrack | null>;
};

export const QUIZ_LIVE_AUDIO_DEFAULTS: QuizLiveAudioSettings = {
  musicVolume: 28,
  effectsVolume: 72,
  tracks: {
    lobbyMusic: null,
    gameMusic: null,
    startBell: null,
    countdownBeep: null,
    scoreTick: null,
    finishBell: null,
    podiumFanfare: null,
  },
};

export const QUIZ_LIVE_AUDIO_SLOT_INFO: Record<QuizLiveAudioSlot, {
  label: string;
  description: string;
  kind: "music" | "effect";
}> = {
  lobbyMusic: { label: "대기실 배경음악", description: "참여자가 들어와 호스트를 기다리는 동안 반복 재생합니다.", kind: "music" },
  gameMusic: { label: "퀴즈 진행 배경음악", description: "첫 문제가 시작된 뒤 최종 결과 전까지 반복 재생합니다.", kind: "music" },
  startBell: { label: "퀴즈 시작 종소리", description: "호스트가 첫 문제를 시작할 때 한 번 재생합니다.", kind: "effect" },
  countdownBeep: { label: "3·2·1 카운트다운 비프", description: "카운트다운 숫자가 바뀔 때마다 같은 효과음을 재생합니다.", kind: "effect" },
  scoreTick: { label: "점수 카운트업 비프", description: "획득 점수와 순위판 숫자가 올라가는 동안 짧게 반복합니다.", kind: "effect" },
  finishBell: { label: "최종 점수 종소리", description: "세션 종료와 최종 점수 공개 시 한 번 재생합니다.", kind: "effect" },
  podiumFanfare: { label: "TOP 3 나팔", description: "문항별 TOP 3와 최종 시상대가 공개될 때 재생합니다.", kind: "effect" },
};

export function isQuizLiveAudioSlot(value: string): value is QuizLiveAudioSlot {
  return (QUIZ_LIVE_AUDIO_SLOTS as readonly string[]).includes(value);
}
