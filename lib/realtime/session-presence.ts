// 세션별로 현재 연결된 "학생"을 추적합니다. 한 학생이 여러 탭에서 접속해도 한 명으로 세며,
// 호스트 소켓은 참여 인원에 포함하지 않습니다. 서버 재시작 시 소실되어도 재연결로 복구됩니다.
type ParticipantSockets = Map<string, Set<string>>;
type PresenceMap = Map<string, ParticipantSockets>;

const globalForPresence = globalThis as unknown as { quizSessionPresence?: PresenceMap };

function getMap(): PresenceMap {
  if (!globalForPresence.quizSessionPresence) globalForPresence.quizSessionPresence = new Map();
  return globalForPresence.quizSessionPresence;
}

export function addPresence(sessionId: string, participantId: string, socketId: string): number {
  const map = getMap();
  const participants = map.get(sessionId) ?? new Map<string, Set<string>>();
  const sockets = participants.get(participantId) ?? new Set<string>();
  sockets.add(socketId);
  participants.set(participantId, sockets);
  map.set(sessionId, participants);
  return participants.size;
}

export function tryAddPresence(
  sessionId: string,
  participantId: string,
  socketId: string,
  maxSockets: number,
): { allowed: boolean; participantCount: number } {
  const map = getMap();
  const participants = map.get(sessionId) ?? new Map<string, Set<string>>();
  const sockets = participants.get(participantId) ?? new Set<string>();
  if (!sockets.has(socketId) && sockets.size >= maxSockets) {
    return { allowed: false, participantCount: participants.size };
  }
  sockets.add(socketId);
  participants.set(participantId, sockets);
  map.set(sessionId, participants);
  return { allowed: true, participantCount: participants.size };
}

export function removePresence(sessionId: string, participantId: string, socketId: string): number {
  const map = getMap(); const participants = map.get(sessionId);
  if (!participants) return 0;
  const sockets = participants.get(participantId);
  sockets?.delete(socketId);
  if (!sockets || sockets.size === 0) participants.delete(participantId);
  if (participants.size === 0) map.delete(sessionId);
  return participants.size;
}

export function presenceCount(sessionId: string): number {
  return getMap().get(sessionId)?.size ?? 0;
}
