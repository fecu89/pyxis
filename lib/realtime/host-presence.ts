// LIVE 세션의 호스트 소켓 접속 상태를 세션별로 추적합니다.
//
// 참여자 presence(session-presence.ts)와 분리한 이유: 호스트는 participantId가 없어서 참여 인원
// 집계에 들어가지 않고, 여러 탭을 열어도 "한 명의 호스트"로 취급해야 합니다.
//
// 자동 종료 타이머도 여기서 관리합니다. socket-server.ts의 liveTimers는 세션당 타이머를 하나만
// 들고 있어서(문항 제한시간용) 거기에 얹으면 서로 덮어씁니다.

type HostSockets = Map<string, Set<string>>;
type AbsenceTimers = Map<string, ReturnType<typeof setTimeout>>;

const globalForHostPresence = globalThis as typeof globalThis & {
  __quizHostSockets?: HostSockets;
  __quizHostAbsenceTimers?: AbsenceTimers;
};

const hostSockets = globalForHostPresence.__quizHostSockets ?? new Map<string, Set<string>>();
globalForHostPresence.__quizHostSockets = hostSockets;

const absenceTimers = globalForHostPresence.__quizHostAbsenceTimers ?? new Map<string, ReturnType<typeof setTimeout>>();
globalForHostPresence.__quizHostAbsenceTimers = absenceTimers;

/** 호스트가 이탈한 뒤 세션을 자동 종료하기까지 기다리는 시간. 새로고침·일시적 끊김을 흡수합니다. */
export const HOST_ABSENCE_GRACE_MS = 60_000;

export function addHostSocket(sessionId: string, socketId: string): number {
  const sockets = hostSockets.get(sessionId) ?? new Set<string>();
  sockets.add(socketId);
  hostSockets.set(sessionId, sockets);
  return sockets.size;
}

export function removeHostSocket(sessionId: string, socketId: string): number {
  const sockets = hostSockets.get(sessionId);
  if (!sockets) return 0;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    hostSockets.delete(sessionId);
    return 0;
  }
  return sockets.size;
}

export function hostSocketCount(sessionId: string): number {
  return hostSockets.get(sessionId)?.size ?? 0;
}

export function cancelHostAbsenceTimer(sessionId: string) {
  const timer = absenceTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  absenceTimers.delete(sessionId);
}

export function hasHostAbsenceTimer(sessionId: string) {
  return absenceTimers.has(sessionId);
}

/**
 * 호스트가 모두 나간 세션에 자동 종료를 예약합니다. 이미 예약돼 있으면 그대로 둡니다
 * (여러 탭이 순서대로 닫히며 유예 시간이 매번 초기화되는 것을 막습니다).
 */
export function scheduleHostAbsenceEnd(sessionId: string, run: () => Promise<void>, delayMs = HOST_ABSENCE_GRACE_MS) {
  if (absenceTimers.has(sessionId)) return;
  const handle = setTimeout(() => {
    absenceTimers.delete(sessionId);
    void run().catch((error) => console.error("[quiz:host-absence-timer]", error));
  }, delayMs);
  absenceTimers.set(sessionId, handle);
}
