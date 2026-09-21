import type { Server, Socket } from "socket.io";
import { parse as parseCookieHeader } from "cookie";
import { getPrisma } from "@/lib/prisma";
import { QUIZ_NAMESPACE, QUIZ_PUBLIC_NAMESPACE } from "@/lib/realtime/namespaces";
import { gradeAndRecordAnswer } from "@/lib/quiz/grading";
import { findGuestParticipant, guestCookieName } from "@/lib/quiz/guest-access";
import { addPresence, presenceCount, removePresence, tryAddPresence } from "@/lib/realtime/session-presence";
import {
  addHostSocket,
  cancelHostAbsenceTimer,
  hasHostAbsenceTimer,
  hostSocketCount,
  removeHostSocket,
  scheduleHostAbsenceEnd,
} from "@/lib/realtime/host-presence";
import type { QuestionType } from "@/generated/prisma/enums";
import type { AnswerPalette, SystemPermission, UserRole } from "@/generated/prisma/enums";
import { canManageAnySession } from "@/lib/auth/permissions";
import { buildQuestionSequencePayload, questionSequenceDelayMs } from "@/lib/quiz/question-sequence";
import { buildLeaderboardEntries } from "@/lib/quiz/live-leaderboard";
import { publicQuestionData } from "@/lib/quiz/public-question";
import { isParticipationType } from "@/lib/quiz/participation";
import { DROP_PIN_RENDER_LIMIT, loadParticipationSummary } from "@/lib/quiz/participation-summary";
import { parsePinAreas, parsePinPoint } from "@/lib/quiz/image-pin";
import { createRateLimiter } from "@/lib/security/rate-limit-core";
import { trustedClientIdentifier } from "@/lib/security/request-identity";
import { getPlatformSecurityPolicy } from "@/lib/security/platform-policy";
import { invalidateShortLinkSlug } from "@/lib/short-links/cache";
import {
  answerSocketPayloadSchema,
  kickSocketPayloadSchema,
  parseSocketPayload,
  sessionSocketPayloadSchema,
} from "@/lib/realtime/socket-payload";

interface SocketData {
  userId: string;
  role: UserRole;
  systemPermissions: SystemPermission[];
  sessionId?: string;
  participantId?: string;
  isHost?: boolean;
}

type QuizSocket = Socket<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, SocketData>;
type PublicSocket = Socket<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, {
  sessionId?: string;
  participantId?: string;
  releaseConnection?: () => void;
}>;
// namespace 이름은 서버·클라이언트가 공유하는 lib/realtime/namespaces.ts가 정본입니다.
// 기본 namespace("/")를 쓰지 않는 이유는 그 파일 주석 참고.

const publicSocketEventLimiters = new Map<number, ReturnType<typeof createRateLimiter>>();
const MAX_PUBLIC_EVENT_LIMITERS = 8;
let publicSocketConnections = 0;
const publicSocketConnectionsByIp = new Map<string, number>();
const registrationState = globalThis as typeof globalThis & {
  __pyxisQuizSocketServers?: WeakSet<Server>;
  __pyxisPublicQuizSocketServers?: WeakSet<Server>;
};
const registeredQuizServers = registrationState.__pyxisQuizSocketServers ?? new WeakSet<Server>();
const registeredPublicQuizServers = registrationState.__pyxisPublicQuizSocketServers ?? new WeakSet<Server>();
registrationState.__pyxisQuizSocketServers = registeredQuizServers;
registrationState.__pyxisPublicQuizSocketServers = registeredPublicQuizServers;

function publicSocketEventLimiter(maxAttempts: number) {
  const existing = publicSocketEventLimiters.get(maxAttempts);
  if (existing) return existing;
  const created = createRateLimiter({ windowMs: 60_000, maxAttempts });
  while (publicSocketEventLimiters.size >= MAX_PUBLIC_EVENT_LIMITERS) {
    const oldestKey = publicSocketEventLimiters.keys().next().value as number | undefined;
    if (oldestKey === undefined) break;
    publicSocketEventLimiters.get(oldestKey)?.dispose();
    publicSocketEventLimiters.delete(oldestKey);
  }
  publicSocketEventLimiters.set(maxAttempts, created);
  return created;
}

type LiveTimer = { kind: "INTRO" | "QUESTION"; deadline: number; handle: ReturnType<typeof setTimeout> };
const globalLiveTimers = globalThis as typeof globalThis & { __quizLiveTimers?: Map<string, LiveTimer> };
const liveTimers = globalLiveTimers.__quizLiveTimers ?? new Map<string, LiveTimer>();
globalLiveTimers.__quizLiveTimers = liveTimers;

function roomName(sessionId: string) {
  return `session:${sessionId}`;
}

// JWT는 7일간 유효하므로 서명 검증만으로는 "정지된 계정 / 가입 승인 대기·반려 계정 /
// 비밀번호가 재설정된 학생"이 남은 기간 내내 소켓으로 접속할 수 있습니다.
// REST(proxy·jwt 콜백)와 동일하게 핸드셰이크에서도 현재 DB 상태와 authVersion을 확인합니다.
export async function verifySocketUser(userId: string, authVersion: number | null) {
  const user = await getPrisma().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      status: true,
      registrationApprovalStatus: true,
      authVersion: true,
      // 남의 세션을 진행할 수 있는지는 역할이 아니라 부여된 시스템 권한으로 갈리므로 함께 읽습니다.
      systemPermissions: { select: { permission: true } },
    },
  });
  if (!user || user.status !== "ACTIVE" || user.registrationApprovalStatus !== "APPROVED") return null;
  if (authVersion !== null && user.authVersion !== authVersion) return null;
  return {
    id: user.id,
    role: user.role,
    systemPermissions: user.systemPermissions.map(({ permission }) => permission),
  };
}

function emitToSession(io: Server, sessionId: string, event: string, payload: unknown) {
  const room = roomName(sessionId);
  io.of(QUIZ_NAMESPACE).to(room).emit(event, payload);
  io.of(QUIZ_PUBLIC_NAMESPACE).to(room).emit(event, payload);
}

function hostRoomName(sessionId: string) {
  return `${roomName(sessionId)}:hosts`;
}

// 참여자 입·퇴장은 학생 화면이 소비하지 않습니다. 호스트 전용 방으로만 보내 참가자 닉네임을
// 불필요하게 전체 방에 싣지 않고, 100명 입장 때 사용하지 않는 payload fan-out도 줄입니다.
function emitToSessionHosts(io: Server, sessionId: string, event: string, payload: unknown) {
  io.of(QUIZ_NAMESPACE).to(hostRoomName(sessionId)).emit(event, payload);
}

function liveParticipantPayload(participant: {
  id: string;
  nickname: string;
  score: number;
  status: string;
  currentQuestionIndex: number;
  joinedAt: Date;
}) {
  return {
    id: participant.id,
    nickname: participant.nickname,
    score: participant.score,
    status: participant.status,
    currentQuestionIndex: participant.currentQuestionIndex,
    joinedAt: participant.joinedAt.toISOString(),
  };
}

async function loadSession(sessionId: string) {
  return getPrisma().quizSession.findUnique({
    where: { id: sessionId },
    include: { quiz: { include: { questions: { orderBy: { position: "asc" }, include: { choices: { orderBy: { position: "asc" } } } } } } },
  });
}

// 한 반이 동시에 입장하면 동일한 세션/문항 전문 조회가 참여자 수만큼 겹칠 수 있습니다.
// 완료된 값을 캐시하지 않고 진행 중인 입장 조회만 합쳐, 상태 지연 없이 DB stampede만 막습니다.
const pendingJoinSessionLoads = new Map<string, ReturnType<typeof loadSession>>();

async function loadSessionForJoin(sessionId: string) {
  const pending = pendingJoinSessionLoads.get(sessionId);
  if (pending) return pending;

  const load = loadSession(sessionId);
  pendingJoinSessionLoads.set(sessionId, load);
  try {
    return await load;
  } finally {
    if (pendingJoinSessionLoads.get(sessionId) === load) {
      pendingJoinSessionLoads.delete(sessionId);
    }
  }
}

// 답안 제출은 세션에서 가장 잦은 이벤트(참여자 수 × 문항 수)인데, loadSession()은 매번 퀴즈
// 전문을 — base64 이미지가 실린 모든 문항과 보기까지 — 끌어옵니다. 제출 검증에 실제로 필요한
// 것은 진행 상태와 "현재 문항"뿐이므로 그만 읽습니다.
async function loadAnswerContext(sessionId: string) {
  const session = await getPrisma().quizSession.findUnique({
    where: { id: sessionId },
    select: { id: true, hostId: true, status: true, livePhase: true, requiresLogin: true, currentQuestionIndex: true, currentQuestionStartedAt: true, quizId: true },
  });
  if (!session || session.currentQuestionIndex === null) return { session, currentQuestion: null };

  const currentQuestion = await getPrisma().question.findFirst({
    where: { quizId: session.quizId },
    orderBy: { position: "asc" },
    skip: session.currentQuestionIndex,
    select: {
      id: true,
      type: true,
      timeLimitSec: true,
      revealResponsesLive: true,
      points: true,
      acceptedAnswers: true,
      orderedItems: true,
      numericMin: true,
      numericMax: true,
      numericAnswer: true,
      multipleSelection: true,
      pinAreas: true,
      likertSteps: true,
      choices: { select: { id: true, text: true, isCorrect: true } },
    },
  });
  return { session, currentQuestion };
}

// 문항이 열린 직후에는 한 반의 답안이 같은 수백 ms 안에 몰립니다. 완료된 상태를 캐시하면
// 호스트가 다음 단계로 넘긴 뒤에도 낡은 문항을 볼 수 있으므로, 현재 실행 중인 두 SELECT만
// 공유하고 끝나는 즉시 버립니다.
const pendingAnswerContexts = new Map<string, ReturnType<typeof loadAnswerContext>>();

async function loadAnswerContextForSubmission(sessionId: string) {
  const pending = pendingAnswerContexts.get(sessionId);
  if (pending) return pending;

  const load = loadAnswerContext(sessionId);
  pendingAnswerContexts.set(sessionId, load);
  try {
    return await load;
  } finally {
    if (pendingAnswerContexts.get(sessionId) === load) pendingAnswerContexts.delete(sessionId);
  }
}

function isHost(socket: QuizSocket, session: { hostId: string }) {
  return socket.data.userId === session.hostId || canManageAnySession(socket.data);
}

// 클라이언트에는 정답 플래그를 절대 포함하지 않고 텍스트/보기/제한시간/배점만 내려보냅니다.
// SHORT_ANSWER는 choices가 항상 빈 배열이라 그대로 내려도 정답(acceptedAnswers)이 노출되지 않습니다.
function publicQuestionPayload(question: {
  id: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  imageAlt: string | null;
  imagePlaceholder: string | null;
  timeLimitSec: number;
  points: number;
  position: number;
  orderedItems: string[];
  numericMin: number | null;
  numericMax: number | null;
  numericAnswer: number | null;
  multipleSelection: boolean;
  slideLayout: import("@/generated/prisma/enums").SlideLayout | null;
  slideBody: string | null;
  likertSteps: number | null;
  likertMinLabel: string | null;
  likertMaxLabel: string | null;
  choices: { id: string; text: string; position: number; isCorrect?: boolean }[];
}, totalQuestions: number, answerPalette: AnswerPalette, startedAt: Date) {
  return {
    ...publicQuestionData(question, totalQuestions, answerPalette),
    startedAt: startedAt.toISOString(),
  };
}

async function buildLeaderboard(sessionId: string, questionId?: string) {
  const [participants, questionAnswers] = await Promise.all([
    getPrisma().sessionParticipant.findMany({
      where: { sessionId, status: { not: "KICKED" } },
      select: { id: true, nickname: true, score: true, joinedAt: true },
    }),
    questionId
      ? getPrisma().answer.findMany({ where: { sessionId, questionId }, select: { participantId: true, pointsAwarded: true } })
      : Promise.resolve([]),
  ]);
  const pointsAwardedByParticipant = new Map(questionAnswers.map((answer) => [answer.participantId, answer.pointsAwarded]));
  return buildLeaderboardEntries(participants, pointsAwardedByParticipant, { includePreviousTop: Boolean(questionId) });
}

const pendingJoinFinalLeaderboards = new Map<string, ReturnType<typeof buildLeaderboard>>();

async function buildFinalLeaderboardForJoin(sessionId: string) {
  const pending = pendingJoinFinalLeaderboards.get(sessionId);
  if (pending) return pending;
  const load = buildLeaderboard(sessionId);
  pendingJoinFinalLeaderboards.set(sessionId, load);
  try {
    return await load;
  } finally {
    if (pendingJoinFinalLeaderboards.get(sessionId) === load) pendingJoinFinalLeaderboards.delete(sessionId);
  }
}

async function buildQuestionReveal(sessionId: string, question: NonNullable<Awaited<ReturnType<typeof loadSession>>>["quiz"]["questions"][number]) {
  if (question.type === "SLIDE") return { questionId: question.id, type: "SLIDE" as const };
  // 참여형은 "정답"이 아니라 모인 응답 자체가 공개 내용입니다. 실시간 공개를 꺼 둔 문항도
  // 이 단계에서는 보여 줍니다 — 끄는 목적이 "먼저 답한 사람이 뒤에 영향 주는 것"을 막는 데
  // 있지 결과를 영영 숨기는 데 있지 않습니다.
  if (isParticipationType(question.type)) {
    const summary = await loadParticipationSummary(sessionId, question);
    return { questionId: question.id, type: question.type, summary };
  }
  if (question.type === "PIN_ANCHOR") {
    const answers = await getPrisma().answer.findMany({ where: { sessionId, questionId: question.id }, select: { isCorrect: true, textResponse: true } });
    return {
      questionId: question.id,
      type: "PIN_ANCHOR" as const,
      // 정답 영역은 공개 단계에서 처음으로 내려갑니다. 그 전에 보내면 개발자 도구로 읽힙니다.
      pinAreas: parsePinAreas(question.pinAreas),
      // 참가자가 많으면 핀이 이미지를 덮어 분포가 안 보이고 페이로드도 커집니다. 드롭 핀과 같은
      // 상한을 씁니다(정답 수는 아래 correctCount로 전부 세므로 잘려도 통계는 정확합니다).
      pins: answers
        .flatMap((answer) => { const point = parsePinPoint(answer.textResponse); return point ? [{ point, isCorrect: answer.isCorrect }] : []; })
        .slice(-DROP_PIN_RENDER_LIMIT),
      correctCount: answers.filter((answer) => answer.isCorrect).length,
      totalAnswered: answers.length,
    };
  }
  if (question.type === "SHORT_ANSWER") {
    const answers = await getPrisma().answer.findMany({ where: { sessionId, questionId: question.id }, select: { isCorrect: true } });
    return { questionId: question.id, type: "SHORT_ANSWER" as const, acceptedAnswers: question.acceptedAnswers, correctCount: answers.filter((answer) => answer.isCorrect).length, totalAnswered: answers.length };
  }
  if (question.type === "ORDERING") {
    const answers = await getPrisma().answer.findMany({ where: { sessionId, questionId: question.id }, select: { isCorrect: true } });
    return { questionId: question.id, type: "ORDERING" as const, correctOrder: question.orderedItems, correctCount: answers.filter((answer) => answer.isCorrect).length, totalAnswered: answers.length };
  }
  if (question.type === "NUMERIC") {
    const answers = await getPrisma().answer.findMany({ where: { sessionId, questionId: question.id }, select: { isCorrect: true } });
    return { questionId: question.id, type: "NUMERIC" as const, numericAnswer: question.numericAnswer, correctCount: answers.filter((answer) => answer.isCorrect).length, totalAnswered: answers.length };
  }
  const correctChoiceIds = question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.id);
  const answers = await getPrisma().answer.findMany({ where: { sessionId, questionId: question.id }, select: { choiceId: true, selectedChoiceIds: true } });
  return { questionId: question.id, type: question.type, correctChoiceId: correctChoiceIds[0] ?? null, correctChoiceIds, choiceBreakdown: question.choices.map((choice) => ({ choiceId: choice.id, count: answers.filter((answer) => (answer.selectedChoiceIds.length ? answer.selectedChoiceIds : answer.choiceId ? [answer.choiceId] : []).includes(choice.id)).length })) };
}

async function emitPersonalAnswerResults(io: Server, sessionId: string, questionId: string) {
  const room = roomName(sessionId);
  const [answers, authenticatedSockets, publicSockets] = await Promise.all([
    getPrisma().answer.findMany({ where: { sessionId, questionId }, select: { participantId: true, isCorrect: true, pointsAwarded: true } }),
    io.of(QUIZ_NAMESPACE).in(room).fetchSockets(),
    io.of(QUIZ_PUBLIC_NAMESPACE).in(room).fetchSockets(),
  ]);
  const resultByParticipant = new Map(answers.map((answer) => [answer.participantId, answer]));
  for (const socket of [...authenticatedSockets, ...publicSockets]) {
    const participantId = (socket.data as { participantId?: string }).participantId;
    const result = participantId ? resultByParticipant.get(participantId) : null;
    if (result) socket.emit("answer:result", { questionId, isCorrect: result.isCorrect, pointsAwarded: result.pointsAwarded });
  }
}

async function buildPersonalAnswerResult(sessionId: string, questionId: string, participantId?: string) {
  if (!participantId) return null;
  const answer = await getPrisma().answer.findFirst({
    where: { sessionId, questionId, participantId },
    select: { isCorrect: true, pointsAwarded: true },
  });
  return answer ? { questionId, isCorrect: answer.isCorrect, pointsAwarded: answer.pointsAwarded } : null;
}

// 제출 한 건마다 COUNT 쿼리 + 룸 전체 브로드캐스트를 돌리면 N명이 동시에 답할 때 N번의 쿼리와
// N×N번의 메시지가 나갑니다. 진행률은 대략적인 수치면 충분하므로 세션별로 묶어서 보냅니다.
const ANSWER_PROGRESS_INTERVAL_MS = 400;
const globalProgressTimers = globalThis as typeof globalThis & { __quizProgressTimers?: Map<string, ReturnType<typeof setTimeout>> };
const progressTimers = globalProgressTimers.__quizProgressTimers ?? new Map<string, ReturnType<typeof setTimeout>>();
globalProgressTimers.__quizProgressTimers = progressTimers;

function scheduleAnswerProgress(io: Server, sessionId: string, questionId: string) {
  if (progressTimers.has(sessionId)) return;
  const handle = setTimeout(() => {
    progressTimers.delete(sessionId);
    void getPrisma().answer
      .count({ where: { sessionId, questionId } })
      // 진행률은 호스트 화면만 사용합니다. 학생 100명에게 400ms마다 같은 집계를 방송하지 않습니다.
      .then((answeredCount) => emitToSessionHosts(io, sessionId, "answer:progress", { answeredCount, participantCount: presenceCount(sessionId) }))
      .catch((error) => console.error("[quiz:answer-progress]", error));
  }, ANSWER_PROGRESS_INTERVAL_MS);
  progressTimers.set(sessionId, handle);
}

/**
 * 참여형 문항의 실시간 집계를 호스트 화면에만 보냅니다.
 *
 * 학생에게 보내지 않는 이유: 아직 답하지 않은 학생이 남들의 응답을 먼저 보면 그쪽으로 쏠려
 * 분포 자체가 의미를 잃습니다. 모두가 함께 보는 것은 정답 공개(question:reveal) 단계입니다.
 * 문항의 revealResponsesLive가 꺼져 있으면 호스트에게도 보내지 않습니다.
 *
 * 진행률(answer:progress)과 같은 이유로 세션 단위로 묶어 보냅니다 — 제출 한 건마다 전체 응답을
 * 다시 집계하면 30명이 동시에 답할 때 30번의 전체 조회가 나갑니다.
 */
const globalSummaryTimers = globalThis as typeof globalThis & { __quizSummaryTimers?: Map<string, ReturnType<typeof setTimeout>> };
const summaryTimers = globalSummaryTimers.__quizSummaryTimers ?? new Map<string, ReturnType<typeof setTimeout>>();
globalSummaryTimers.__quizSummaryTimers = summaryTimers;

function scheduleParticipationSummary(io: Server, sessionId: string, questionId: string) {
  if (summaryTimers.has(sessionId)) return;
  const handle = setTimeout(() => {
    summaryTimers.delete(sessionId);
    void (async () => {
      const question = await getPrisma().question.findUnique({
        where: { id: questionId },
        select: { id: true, type: true, likertSteps: true, revealResponsesLive: true, choices: { orderBy: { position: "asc" }, select: { id: true } } },
      });
      if (!question || !isParticipationType(question.type) || !question.revealResponsesLive) return;
      const summary = await loadParticipationSummary(sessionId, question);
      if (!summary) return;
      // 인증 namespace 전체를 조회·순회하지 않고 이미 분리한 호스트 전용 room에 바로 보냅니다.
      emitToSessionHosts(io, sessionId, "participation:update", { questionId, summary });
    })().catch((error) => console.error("[quiz:participation-summary]", error));
  }, ANSWER_PROGRESS_INTERVAL_MS);
  summaryTimers.set(sessionId, handle);
}

/**
 * 세션을 종료 상태로 확정하고 룸 전체에 알립니다. 호스트의 host:end와 호스트 이탈 자동 종료가
 * 같은 경로를 쓰도록 분리했습니다. 이미 끝난 세션이면 아무것도 하지 않고 false를 돌려줍니다.
 */
async function finishSession(io: Server, sessionId: string) {
  clearLiveTimer(sessionId);
  cancelHostAbsenceTimer(sessionId);

  // 이미 종료된 세션을 다시 종료하지 않도록 조건부 갱신으로 한 번만 통과시킵니다.
  const { result: changed, disabledSlugs } = await getPrisma().$transaction(async (tx) => {
    const endedAt = new Date();
    const result = await tx.quizSession.updateMany({
      where: { id: sessionId, status: { notIn: ["FINISHED", "CANCELLED"] } },
      data: { status: "FINISHED", livePhase: "ENDED", endedAt, pinCode: null },
    });
    const links = result.count === 1
      ? await tx.shortLink.findMany({ where: { quizSessionId: sessionId, disabledAt: null }, select: { slug: true } })
      : [];
    if (links.length) {
      await tx.shortLink.updateMany({
        where: { quizSessionId: sessionId, disabledAt: null },
        data: { disabledAt: endedAt },
      });
    }
    const disabledSlugs = links.map(({ slug }) => slug);
    return { result, disabledSlugs };
  });
  for (const slug of disabledSlugs) invalidateShortLinkSlug(slug);
  if (changed.count !== 1) return false;

  // 순위 조회가 순간 실패해도 DB는 이미 FINISHED입니다. 종료 이벤트 자체까지 잃으면 모든 화면이
  // 진행 중에 멈추므로 빈 시상대로라도 먼저 종료시키고, 재접속 때 순위를 다시 읽게 합니다.
  let finalLeaderboard: Awaited<ReturnType<typeof buildLeaderboard>> = [];
  try {
    finalLeaderboard = await buildLeaderboard(sessionId);
  } catch (error) {
    console.error("[quiz:final-leaderboard]", error);
  }
  emitToSession(io, sessionId, "session:ended", { finalLeaderboard });
  return true;
}

/**
 * 호스트가 유예 시간 안에 돌아오지 않았을 때 실행됩니다. 타이머가 걸린 뒤 호스트가 재접속했거나
 * 세션이 이미 끝났을 수 있으므로 실행 시점에 다시 확인합니다.
 */
async function endSessionOnHostAbsence(io: Server, sessionId: string) {
  if (hostSocketCount(sessionId) > 0) return;

  const session = await getPrisma().quizSession.findUnique({
    where: { id: sessionId },
    select: { mode: true, status: true },
  });
  if (!session || session.mode !== "LIVE") return;
  if (session.status === "FINISHED" || session.status === "CANCELLED") return;

  if (await finishSession(io, sessionId)) {
    console.log(`[quiz:host-absence] 호스트 미복귀로 세션을 자동 종료했습니다: ${sessionId}`);
  }
}

/** 호스트 소켓이 모두 사라졌을 때 자동 종료를 예약합니다. LIVE·진행 가능 상태에서만 겁니다. */
async function armHostAbsenceEnd(io: Server, sessionId: string) {
  if (hostSocketCount(sessionId) > 0) return;
  const session = await getPrisma().quizSession.findUnique({
    where: { id: sessionId },
    select: { mode: true, status: true },
  });
  if (!session || session.mode !== "LIVE") return;
  if (session.status === "FINISHED" || session.status === "CANCELLED") return;
  scheduleHostAbsenceEnd(sessionId, () => endSessionOnHostAbsence(io, sessionId));
}

function clearLiveTimer(sessionId: string) {
  const timer = liveTimers.get(sessionId);
  if (timer) clearTimeout(timer.handle);
  liveTimers.delete(sessionId);
}

function setLiveTimer(sessionId: string, kind: LiveTimer["kind"], deadline: number, run: () => Promise<void>) {
  const existing = liveTimers.get(sessionId);
  if (existing?.kind === kind && existing.deadline === deadline) return;
  clearLiveTimer(sessionId);

  const schedule = (delayMs: number, attempt: number) => {
    const handle = setTimeout(() => {
      const current = liveTimers.get(sessionId);
      if (current?.handle === handle) liveTimers.delete(sessionId);
      void run().catch((error) => {
        console.error(`[quiz:${kind.toLowerCase()}-timer]`, error);
        // DB나 공개 페이로드 조회가 순간적으로 실패해도 세션을 QUESTION_ACTIVE에 영구히
        // 남기지 않습니다. 새 문항 타이머가 이미 생겼다면 그 타이머를 건드리지 않습니다.
        if (attempt >= 2 || liveTimers.has(sessionId)) return;
        schedule(500 * (attempt + 1), attempt + 1);
      });
    }, delayMs);
    liveTimers.set(sessionId, { kind, deadline, handle });
  };

  schedule(Math.max(0, deadline - Date.now()), 0);
}

async function showLeaderboard(io: Server, sessionId: string, expectedQuestionId: string) {
  const session = await loadSession(sessionId);
  const question = session?.currentQuestionIndex !== null && session?.currentQuestionIndex !== undefined
    ? session.quiz.questions[session.currentQuestionIndex]
    : null;
  if (!session || !question || question.id !== expectedQuestionId || session.status !== "IN_PROGRESS" || session.livePhase !== "QUESTION_REVEAL") return false;

  const changed = await getPrisma().quizSession.updateMany({
    where: { id: sessionId, status: "IN_PROGRESS", livePhase: "QUESTION_REVEAL", currentQuestionIndex: session.currentQuestionIndex },
    data: { livePhase: "LEADERBOARD" },
  });
  if (changed.count !== 1) return false;
  emitToSession(io, sessionId, "leaderboard:show", { questionId: question.id, leaderboard: await buildLeaderboard(sessionId, question.id) });
  return true;
}

async function revealCurrentQuestion(io: Server, sessionId: string, expectedQuestionIndex?: number) {
  const session = await loadSession(sessionId);
  if (!session || session.status !== "IN_PROGRESS" || session.livePhase !== "QUESTION_ACTIVE" || session.currentQuestionIndex === null) return false;
  if (expectedQuestionIndex !== undefined && session.currentQuestionIndex !== expectedQuestionIndex) return false;
  if (!session.currentQuestionStartedAt || Date.now() < session.currentQuestionStartedAt.getTime()) return false;
  const question = session.quiz.questions[session.currentQuestionIndex];
  if (!question) return false;
  // 슬라이드는 정답 공개 단계가 없습니다 — 호스트의 "다음 문제"로만 넘어갑니다.
  if (question.type === "SLIDE") return false;

  // 공개 페이로드 생성이 실패할 수 있는 지점(DB 조회·핀 데이터 검증)을 상태 변경보다 먼저
  // 끝냅니다. 예전 순서는 DB만 QUESTION_REVEAL로 바뀐 뒤 이벤트가 누락되어, 화면은 0초에
  // 멈추고 수동 공개도 거절되는 복구 불가능한 상태를 만들 수 있었습니다.
  const reveal = await buildQuestionReveal(sessionId, question);
  const changed = await getPrisma().quizSession.updateMany({
    where: { id: sessionId, status: "IN_PROGRESS", livePhase: "QUESTION_ACTIVE", currentQuestionIndex: session.currentQuestionIndex },
    data: { livePhase: "QUESTION_REVEAL" },
  });
  if (changed.count !== 1) return false;

  clearLiveTimer(sessionId);
  emitToSession(io, sessionId, "question:reveal", reveal);
  // 개인 점수 전달 실패가 전체 공개 이벤트까지 실패한 것으로 보이게 해서는 안 됩니다.
  try {
    await emitPersonalAnswerResults(io, sessionId, question.id);
  } catch (error) {
    console.error("[quiz:answer-result]", error);
  }
  return true;
}

// 미디어 슬라이드는 "정답"이 없는 감상용 화면이라 제한시간·자동 공개 없이 호스트가 넘길 때까지
// 머뭅니다. 여기서 걸러 두면 호출부 세 곳(announce·scheduled·restore)이 조건을 각자 들 필요가 없습니다.
function scheduleQuestionDeadline(io: Server, sessionId: string, questionIndex: number, startedAt: Date, timeLimitSec: number, questionType: QuestionType) {
  if (questionType === "SLIDE") return;
  const deadline = startedAt.getTime() + timeLimitSec * 1000;
  setLiveTimer(sessionId, "QUESTION", deadline, () => revealCurrentQuestion(io, sessionId, questionIndex).then(() => undefined));
}

async function showScheduledQuestion(io: Server, sessionId: string, expectedQuestionIndex: number, expectedStartedAt: Date) {
  const session = await loadSession(sessionId);
  if (!session || session.status !== "IN_PROGRESS" || session.livePhase !== "QUESTION_ACTIVE" || session.currentQuestionIndex !== expectedQuestionIndex) return;
  if (!session.currentQuestionStartedAt || session.currentQuestionStartedAt.getTime() !== expectedStartedAt.getTime()) return;
  const question = session.quiz.questions[expectedQuestionIndex];
  if (!question) return;
  emitToSession(io, sessionId, "question:show", publicQuestionPayload(question, session.quiz.questions.length, session.quiz.answerPalette, session.currentQuestionStartedAt));
  scheduleQuestionDeadline(io, sessionId, expectedQuestionIndex, session.currentQuestionStartedAt, question.timeLimitSec, question.type);
}

function scheduleQuestionStart(io: Server, sessionId: string, questionIndex: number, startsAt: Date) {
  setLiveTimer(sessionId, "INTRO", startsAt.getTime(), () => showScheduledQuestion(io, sessionId, questionIndex, startsAt));
}

function announceQuestion(io: Server, sessionId: string, question: NonNullable<Awaited<ReturnType<typeof loadSession>>>["quiz"]["questions"][number], totalQuestions: number, answerPalette: AnswerPalette, questionIndex: number, startsAt: Date) {
  if (startsAt.getTime() > Date.now()) {
    emitToSession(io, sessionId, "question:sequence", buildQuestionSequencePayload(question, totalQuestions, startsAt));
    scheduleQuestionStart(io, sessionId, questionIndex, startsAt);
    return;
  }
  emitToSession(io, sessionId, "question:show", publicQuestionPayload(question, totalQuestions, answerPalette, startsAt));
  scheduleQuestionDeadline(io, sessionId, questionIndex, startsAt, question.timeLimitSec, question.type);
}

function ensureLiveTimer(io: Server, session: NonNullable<Awaited<ReturnType<typeof loadSession>>>) {
  if (session.status !== "IN_PROGRESS" || session.currentQuestionIndex === null) return;
  const question = session.quiz.questions[session.currentQuestionIndex];
  if (!question) return;
  if (session.livePhase === "QUESTION_ACTIVE" && session.currentQuestionStartedAt) {
    if (session.currentQuestionStartedAt.getTime() > Date.now()) scheduleQuestionStart(io, session.id, session.currentQuestionIndex, session.currentQuestionStartedAt);
    else scheduleQuestionDeadline(io, session.id, session.currentQuestionIndex, session.currentQuestionStartedAt, question.timeLimitSec, question.type);
  }
}

async function restoreLiveTimers(io: Server) {
  const sessions = await getPrisma().quizSession.findMany({
    where: { mode: "LIVE", status: "IN_PROGRESS", livePhase: "QUESTION_ACTIVE" },
    select: { id: true },
  });
  await Promise.all(sessions.map(async ({ id }) => {
    const session = await loadSession(id);
    if (session) ensureLiveTimer(io, session);
  }));
}

/**
 * 재시작 직후에는 인메모리 호스트 접속 정보가 비어 있습니다. 진행 중인 LIVE 세션에 자동 종료를
 * 걸어 두면, 호스트가 소켓 자동 재연결로 돌아올 경우 취소되고 이미 떠난 세션만 정리됩니다.
 */
async function restoreHostAbsenceTimers(io: Server) {
  const sessions = await getPrisma().quizSession.findMany({
    where: { mode: "LIVE", status: { notIn: ["FINISHED", "CANCELLED"] } },
    select: { id: true },
  });
  for (const { id } of sessions) {
    scheduleHostAbsenceEnd(id, () => endSessionOnHostAbsence(io, id));
  }
  if (sessions.length) console.log(`[quiz:host-absence] 재시작 후 ${sessions.length}개 LIVE 세션에 복귀 대기를 걸었습니다.`);
}

// 이탈 이벤트만 믿으면 구멍이 남습니다: 호스트 소켓이 아예 붙지 못한 세션(연결 장애로 만들자마자
// 버려진 LOBBY 등)은 disconnect가 없어 타이머가 걸리지 않고, 부팅 복구는 부팅 이후 생성분을 모릅니다.
// 주기 점검이 그 구멍을 메웁니다 — 호스트가 없고 타이머도 없는 LIVE 세션에 유예 타이머를 겁니다.
const HOST_ABSENCE_SWEEP_MS = 60_000;

function startHostAbsenceSweep(io: Server) {
  setInterval(() => {
    void (async () => {
      const sessions = await getPrisma().quizSession.findMany({
        where: { mode: "LIVE", status: { notIn: ["FINISHED", "CANCELLED"] } },
        select: { id: true },
      });
      for (const { id } of sessions) {
        if (hostSocketCount(id) > 0 || hasHostAbsenceTimer(id)) continue;
        scheduleHostAbsenceEnd(id, () => endSessionOnHostAbsence(io, id));
      }
    })().catch((error) => console.error("[quiz:host-absence-sweep]", error));
  }, HOST_ABSENCE_SWEEP_MS).unref?.();
}

export function registerQuizSocketHandlers(io: Server) {
  if (registeredQuizServers.has(io)) return;
  registeredQuizServers.add(io);
  void restoreLiveTimers(io).catch((error) => console.error("[quiz:restore-live-timers]", error));
  void restoreHostAbsenceTimers(io).catch((error) => console.error("[quiz:restore-host-absence]", error));
  startHostAbsenceSweep(io);
  io.of(QUIZ_NAMESPACE).on("connection", (socket: QuizSocket) => {
    socket.on("session:join", async (payload: unknown, ack?: (res: unknown) => void) => {
      let rollback: { sessionId: string; participantId?: string; presenceAdded: boolean; hostAdded: boolean } | null = null;
      try {
        const { sessionId } = parseSocketPayload(sessionSocketPayloadSchema, payload);
        if (socket.data.sessionId && socket.data.sessionId !== sessionId) {
          throw new Error("한 연결에서는 하나의 세션에만 입장할 수 있습니다.");
        }
        const session = await loadSessionForJoin(sessionId);
        if (!session) throw new Error("세션을 찾을 수 없습니다.");

        const host = isHost(socket, session);
        let joiningParticipant: Parameters<typeof liveParticipantPayload>[0] | null = null;
        if (!host) {
          if (!session.requiresLogin) throw new Error("공개 세션은 공개 참여 화면을 이용해 주세요.");
          const participant = await getPrisma().sessionParticipant.findUnique({
            where: { sessionId_userId: { sessionId, userId: socket.data.userId } },
          });
          if (!participant) throw new Error("이 세션에 참여 등록되어 있지 않습니다. 먼저 PIN으로 입장해 주세요.");
          if (participant.status === "KICKED") throw new Error("호스트가 이 세션에서 내보냈습니다.");
          socket.data.participantId = participant.id;
          joiningParticipant = participant;
        }

        const alreadyJoined = socket.data.sessionId === sessionId;
        if (!alreadyJoined) rollback = { sessionId, participantId: joiningParticipant?.id, presenceAdded: false, hostAdded: false };
        await socket.join(roomName(sessionId));

        if (host) {
          // 호스트가 (재)입장했으니 이탈 자동 종료 예약을 취소합니다.
          await socket.join(hostRoomName(sessionId));
          addHostSocket(sessionId, socket.id);
          if (rollback) rollback.hostAdded = true;
          cancelHostAbsenceTimer(sessionId);
        }

        socket.data.sessionId = sessionId;
        socket.data.isHost = host;

        const participantCount = socket.data.participantId
          ? addPresence(sessionId, socket.data.participantId, socket.id)
          : presenceCount(sessionId);
        if (rollback && socket.data.participantId) rollback.presenceAdded = true;

        if (joiningParticipant) {
          emitToSessionHosts(io, sessionId, "participant:joined", {
            participantCount,
            participant: liveParticipantPayload(joiningParticipant),
          });
        }

        // 호스트 재접속 중 들어온 학생 이벤트는 소켓이 닫혀 있어 받을 수 없습니다. 입장 ACK에
        // 현재 명단을 한 번 실어 이후 델타의 기준을 다시 세웁니다.
        ensureLiveTimer(io, session);
        const currentQuestion = (session.livePhase === "QUESTION_ACTIVE" || session.livePhase === "QUESTION_REVEAL" || session.livePhase === "LEADERBOARD") && session.currentQuestionIndex !== null
          ? session.quiz.questions[session.currentQuestionIndex]
          : null;
        // 재접속 스냅샷의 서로 독립적인 조회를 직렬로 기다리지 않습니다. 특히 LEADERBOARD에서
        // 참가자 명단 → 공개 결과 → 순위를 순서대로 읽던 세 번의 DB 왕복을 한 번의 대기 구간으로 합칩니다.
        const [currentParticipants, currentReveal, currentLeaderboard, currentParticipation, finalLeaderboard] = await Promise.all([
          host && session.status !== "FINISHED"
            ? getPrisma().sessionParticipant.findMany({
                where: { sessionId },
                orderBy: { joinedAt: "asc" },
                select: { id: true, nickname: true, score: true, status: true, currentQuestionIndex: true, joinedAt: true },
              })
            : Promise.resolve(undefined),
          (session.livePhase === "QUESTION_REVEAL" || session.livePhase === "LEADERBOARD") && currentQuestion
            ? buildQuestionReveal(sessionId, currentQuestion)
            : Promise.resolve(null),
          session.livePhase === "LEADERBOARD" && currentQuestion
            ? buildLeaderboard(sessionId, currentQuestion.id)
            : Promise.resolve(null),
          host && currentQuestion && session.livePhase === "QUESTION_ACTIVE"
            && isParticipationType(currentQuestion.type) && currentQuestion.revealResponsesLive
            ? loadParticipationSummary(sessionId, currentQuestion)
            : Promise.resolve(null),
          session.status === "FINISHED" ? buildFinalLeaderboardForJoin(sessionId) : Promise.resolve(null),
        ]);
        const currentAnswerResult = currentReveal && currentQuestion
          ? await buildPersonalAnswerResult(sessionId, currentQuestion.id, socket.data.participantId)
          : null;
        // 아직 보기 공개 전이면(시퀀스 진행 중) 문항 전문 대신 시퀀스만 내려보내 보기 유출을 막습니다.
        const currentSequence = currentQuestion && currentQuestion.type !== "SLIDE" && session.livePhase === "QUESTION_ACTIVE" && session.currentQuestionStartedAt && session.currentQuestionStartedAt.getTime() > Date.now()
          ? buildQuestionSequencePayload(currentQuestion, session.quiz.questions.length, session.currentQuestionStartedAt)
          : null;

        ack?.({
          ok: true,
          status: session.status,
          livePhase: session.livePhase,
          participantCount,
          currentQuestion: currentQuestion && session.currentQuestionStartedAt && !currentSequence
            ? publicQuestionPayload(currentQuestion, session.quiz.questions.length, session.quiz.answerPalette, session.currentQuestionStartedAt)
            : null,
          currentSequence,
          currentReveal,
          currentLeaderboard,
          currentAnswerResult,
          currentParticipation,
          finalLeaderboard,
          participants: currentParticipants?.map(liveParticipantPayload),
        });
      } catch (error) {
        if (rollback) {
          try {
            await socket.leave(roomName(rollback.sessionId));
            await socket.leave(hostRoomName(rollback.sessionId));
          } catch { /* 연결 자체가 끊긴 경우 disconnect 정리가 이어서 처리합니다. */ }
          if (rollback.presenceAdded && rollback.participantId) {
            const participantCount = removePresence(rollback.sessionId, rollback.participantId, socket.id);
            emitToSessionHosts(io, rollback.sessionId, "participant:left", { participantId: rollback.participantId, participantCount });
          }
          if (rollback.hostAdded && removeHostSocket(rollback.sessionId, socket.id) === 0) {
            void armHostAbsenceEnd(io, rollback.sessionId).catch((cause) => console.error("[quiz:rollback-host-join]", cause));
          }
          socket.data.sessionId = undefined;
          socket.data.participantId = undefined;
          socket.data.isHost = undefined;
        }
        ack?.({ ok: false, error: error instanceof Error ? error.message : "입장에 실패했습니다." });
      }
    });

    socket.on("host:start", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const { sessionId } = parseSocketPayload(sessionSocketPayloadSchema, payload);
        const session = await loadSession(sessionId);
        if (!session || !isHost(socket, session)) throw new Error("호스트만 시작할 수 있습니다.");
        if (session.mode !== "LIVE") throw new Error("라이브 세션이 아닙니다.");
        if (session.status !== "LOBBY" || session.livePhase !== "LOBBY") throw new Error("이미 시작했거나 종료된 세션입니다.");
        if (session.quiz.questions.length === 0) throw new Error("문항이 없습니다.");

        const now = new Date();
        const question = session.quiz.questions[0];
        const questionStartedAt = new Date(now.getTime() + questionSequenceDelayMs(question));
        await getPrisma().quizSession.update({
          where: { id: sessionId },
          data: {
            status: "IN_PROGRESS",
            livePhase: "QUESTION_ACTIVE",
            currentQuestionIndex: 0,
            currentQuestionStartedAt: questionStartedAt,
            startedAt: session.startedAt ?? now,
          },
        });

        announceQuestion(io, sessionId, question, session.quiz.questions.length, session.quiz.answerPalette, 0, questionStartedAt);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "시작하지 못했습니다." });
      }
    });

    socket.on("host:next-question", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const { sessionId } = parseSocketPayload(sessionSocketPayloadSchema, payload);
        const session = await loadSession(sessionId);
        if (!session || !isHost(socket, session)) throw new Error("호스트만 진행할 수 있습니다.");
        if (session.status !== "IN_PROGRESS" || session.currentQuestionIndex === null) {
          throw new Error("진행 중인 세션이 아닙니다.");
        }
        // 슬라이드는 공개·순위 단계가 없어 진행 중 화면에서 곧장, 참여형은 점수가 없어
        // 응답 분포 공개(REVEAL) 후 순위 없이 곧장 다음으로 넘어갑니다.
        const currentType = session.quiz.questions[session.currentQuestionIndex]?.type;
        const canAdvance = session.livePhase === "LEADERBOARD"
          || currentType === "SLIDE"
          || (currentType !== undefined && isParticipationType(currentType) && session.livePhase === "QUESTION_REVEAL");
        if (!canAdvance) throw new Error("순위 공개가 끝난 뒤 다음 문항으로 이동할 수 있습니다.");
        const nextIndex = session.currentQuestionIndex + 1;
        if (nextIndex >= session.quiz.questions.length) throw new Error("이미 마지막 문항입니다.");

        const now = new Date();
        const question = session.quiz.questions[nextIndex];
        const questionStartedAt = new Date(now.getTime() + questionSequenceDelayMs(question));
        await getPrisma().quizSession.update({
          where: { id: sessionId },
          data: { currentQuestionIndex: nextIndex, livePhase: "QUESTION_ACTIVE", currentQuestionStartedAt: questionStartedAt },
        });

        announceQuestion(io, sessionId, question, session.quiz.questions.length, session.quiz.answerPalette, nextIndex, questionStartedAt);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "다음 문항으로 넘기지 못했습니다." });
      }
    });

    socket.on("host:reveal", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const { sessionId } = parseSocketPayload(sessionSocketPayloadSchema, payload);
        const session = await loadSession(sessionId);
        if (!session || !isHost(socket, session)) throw new Error("호스트만 공개할 수 있습니다.");
        if (session.currentQuestionIndex === null) throw new Error("진행 중인 문항이 없습니다.");
        const question = session.quiz.questions[session.currentQuestionIndex];
        if (!question) throw new Error("진행 중인 문항이 없습니다.");
        if (session.status !== "IN_PROGRESS") throw new Error("지금은 정답을 공개할 수 없습니다.");
        if (question.type === "SLIDE") throw new Error("슬라이드는 정답 공개 없이 '다음 문제'로 넘어갑니다.");

        // 서버는 이미 공개 상태인데 이 브라우저만 이벤트를 놓친 경우, 오류 대신 현재 공개 화면을
        // 방 전체에 다시 보내 호스트와 참가자를 같은 상태로 복구합니다.
        if (session.livePhase === "QUESTION_REVEAL") {
          emitToSession(io, sessionId, "question:reveal", await buildQuestionReveal(sessionId, question));
          ack?.({ ok: true });
          return;
        }
        if (session.livePhase !== "QUESTION_ACTIVE") throw new Error("지금은 정답을 공개할 수 없습니다.");
        if (!session.currentQuestionStartedAt || Date.now() < session.currentQuestionStartedAt.getTime()) throw new Error("문항 준비(카운트다운·읽기)가 끝난 뒤 정답을 공개할 수 있습니다.");
        if (!(await revealCurrentQuestion(io, sessionId, session.currentQuestionIndex))) throw new Error("이미 정답이 공개되었습니다.");
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "공개하지 못했습니다." });
      }
    });

    // 카운트다운·읽기 대기를 건너뛰고 보기를 즉시 공개합니다. 시작 시각을 지금으로 당겨 저장하므로
    // 속도 점수·제한시간 타이머 모두 새 시각 기준으로 일관되게 동작합니다.
    socket.on("host:skip-sequence", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const { sessionId } = parseSocketPayload(sessionSocketPayloadSchema, payload);
        const session = await loadSession(sessionId);
        if (!session || !isHost(socket, session)) throw new Error("호스트만 건너뛸 수 있습니다.");
        if (session.status !== "IN_PROGRESS" || session.livePhase !== "QUESTION_ACTIVE" || session.currentQuestionIndex === null) throw new Error("진행 중인 문항이 없습니다.");
        const question = session.quiz.questions[session.currentQuestionIndex];
        if (!question || question.type === "SLIDE") throw new Error("슬라이드에는 준비 단계가 없습니다.");
        if (!session.currentQuestionStartedAt || session.currentQuestionStartedAt.getTime() <= Date.now()) throw new Error("이미 보기가 공개된 문항입니다.");

        const now = new Date();
        const changed = await getPrisma().quizSession.updateMany({
          where: { id: sessionId, status: "IN_PROGRESS", livePhase: "QUESTION_ACTIVE", currentQuestionIndex: session.currentQuestionIndex, currentQuestionStartedAt: session.currentQuestionStartedAt },
          data: { currentQuestionStartedAt: now },
        });
        if (changed.count !== 1) throw new Error("이미 보기가 공개된 문항입니다.");

        emitToSession(io, sessionId, "question:show", publicQuestionPayload(question, session.quiz.questions.length, session.quiz.answerPalette, now));
        scheduleQuestionDeadline(io, sessionId, session.currentQuestionIndex, now, question.timeLimitSec, question.type);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "건너뛰지 못했습니다." });
      }
    });

    socket.on("host:show-leaderboard", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const { sessionId } = parseSocketPayload(sessionSocketPayloadSchema, payload);
        const session = await loadSession(sessionId);
        if (!session || !isHost(socket, session)) throw new Error("호스트만 순위를 공개할 수 있습니다.");
        if (session.currentQuestionIndex === null) throw new Error("진행 중인 문항이 없습니다.");
        if (session.status !== "IN_PROGRESS" || session.livePhase !== "QUESTION_REVEAL") throw new Error("정답을 공개한 뒤 순위를 공개할 수 있습니다.");
        const leaderboardType = session.quiz.questions[session.currentQuestionIndex]?.type;
        if (leaderboardType !== undefined && isParticipationType(leaderboardType)) {
          throw new Error("참여형 문항은 점수가 없어 순위 공개 없이 다음 문제로 넘어갑니다.");
        }
        const question = session.quiz.questions[session.currentQuestionIndex];
        if (!question || !(await showLeaderboard(io, sessionId, question.id))) throw new Error("이미 순위가 공개되었습니다.");
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "순위를 공개하지 못했습니다." });
      }
    });

    socket.on("host:end", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const { sessionId } = parseSocketPayload(sessionSocketPayloadSchema, payload);
        const session = await loadSession(sessionId);
        if (!session || !isHost(socket, session)) throw new Error("호스트만 종료할 수 있습니다.");
        if (session.status === "FINISHED" || session.status === "CANCELLED") throw new Error("이미 종료된 세션입니다.");

        if (!(await finishSession(io, sessionId))) throw new Error("이미 종료된 세션입니다.");
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "종료하지 못했습니다." });
      }
    });

    socket.on("host:kick", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const { sessionId, participantId } = parseSocketPayload(kickSocketPayloadSchema, payload);
        const session = await loadSession(sessionId);
        if (!session || !isHost(socket, session)) throw new Error("호스트만 내보낼 수 있습니다.");

        const changed = await getPrisma().sessionParticipant.updateMany({ where: { id: participantId, sessionId }, data: { status: "KICKED" } });
        if (changed.count !== 1) throw new Error("이 세션의 참여자를 찾을 수 없습니다.");

        const room = roomName(sessionId);
        const [authenticatedSockets, publicSockets] = await Promise.all([io.of(QUIZ_NAMESPACE).in(room).fetchSockets(), io.of(QUIZ_PUBLIC_NAMESPACE).in(room).fetchSockets()]);
        const targets = [...authenticatedSockets, ...publicSockets].filter((entry) => (entry.data as { participantId?: string }).participantId === participantId);
        for (const target of targets) {
          target.emit("kicked", {});
          await target.leave(room);
          target.disconnect(true);
        }

        emitToSessionHosts(io, sessionId, "participant:left", { participantId, participantCount: presenceCount(sessionId), kicked: true });
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "내보내지 못했습니다." });
      }
    });

    socket.on(
      "student:submit-answer",
      async (
        payload: unknown,
        ack?: (res: unknown) => void,
      ) => {
        try {
          const { sessionId, questionId, choiceId, choiceIds, textResponse } = parseSocketPayload(answerSocketPayloadSchema, payload);
          const { session, currentQuestion } = await loadAnswerContextForSubmission(sessionId);
          if (!session) throw new Error("세션을 찾을 수 없습니다.");
          if (isHost(socket, session)) throw new Error("호스트는 답을 제출할 수 없습니다.");
          if (!socket.data.participantId || socket.data.sessionId !== sessionId) throw new Error("먼저 세션에 입장해 주세요.");
          if (session.status !== "IN_PROGRESS" || session.livePhase !== "QUESTION_ACTIVE") {
            throw new Error("지금은 답을 제출할 수 없습니다.");
          }
          if (!currentQuestion || currentQuestion.id !== questionId) {
            throw new Error("이미 지나간 문항입니다.");
          }
          if (currentQuestion.type === "SLIDE") throw new Error("콘텐츠 슬라이드는 답을 제출하지 않습니다.");
          if (!session.currentQuestionStartedAt || Date.now() < session.currentQuestionStartedAt.getTime()) {
            throw new Error("문제가 아직 시작되지 않았습니다.");
          }
          if (Date.now() >= session.currentQuestionStartedAt.getTime() + currentQuestion.timeLimitSec * 1000) {
            throw new Error("응답 시간이 끝났습니다.");
          }

          const responseTimeMs = session.currentQuestionStartedAt
            ? Date.now() - session.currentQuestionStartedAt.getTime()
            : null;

          await gradeAndRecordAnswer({
            sessionId,
            participantId: socket.data.participantId,
            questionId,
            choiceId,
            choiceIds,
            textResponse,
            responseTimeMs,
            mode: "LIVE",
            question: currentQuestion,
          });

          // 정오답과 점수는 정답 공개 이후 answer:result로만 보냅니다.
          ack?.({ ok: true });

          scheduleAnswerProgress(io, sessionId, questionId);
          if (isParticipationType(currentQuestion.type) && currentQuestion.revealResponsesLive) {
            scheduleParticipationSummary(io, sessionId, questionId);
          }
        } catch (error) {
          ack?.({ ok: false, error: error instanceof Error ? error.message : "제출하지 못했습니다." });
        }
      },
    );

    socket.on("disconnect", () => {
      const { sessionId, participantId, isHost: wasHost } = socket.data;
      if (!sessionId) return;
      if (participantId) {
        const participantCount = removePresence(sessionId, participantId, socket.id);
        emitToSessionHosts(io, sessionId, "participant:left", { participantId, participantCount });
      }
      if (wasHost && removeHostSocket(sessionId, socket.id) === 0) {
        // 마지막 호스트 탭이 닫혔습니다. 유예 시간 안에 돌아오지 않으면 세션을 자동 종료합니다.
        void armHostAbsenceEnd(io, sessionId).catch((error) => console.error("[quiz:arm-host-absence]", error));
      }
    });
  });
}

export function registerPublicQuizSocketHandlers(io: Server) {
  if (registeredPublicQuizServers.has(io)) return;
  registeredPublicQuizServers.add(io);
  const publicIo = io.of(QUIZ_PUBLIC_NAMESPACE);
  publicIo.use(async (socket: PublicSocket, next) => {
    try {
      const policy = await getPlatformSecurityPolicy();
      const clientIdentifier = trustedClientIdentifier(socket.request.headers);
      const ipConnections = publicSocketConnectionsByIp.get(clientIdentifier) ?? 0;
      if (publicSocketConnections >= policy.publicQuizSocketMaxConnections) {
        next(new Error("공개 퀴즈 연결이 많습니다. 잠시 후 다시 시도해 주세요."));
        return;
      }
      if (ipConnections >= policy.publicQuizSocketConnectionsPerIp) {
        next(new Error("이 네트워크에서 열린 공개 퀴즈 화면이 너무 많습니다."));
        return;
      }
      publicSocketConnections += 1;
      publicSocketConnectionsByIp.set(clientIdentifier, ipConnections + 1);
      let released = false;
      socket.data.releaseConnection = () => {
        if (released) return;
        released = true;
        publicSocketConnections = Math.max(0, publicSocketConnections - 1);
        const nextIpConnections = (publicSocketConnectionsByIp.get(clientIdentifier) ?? 1) - 1;
        if (nextIpConnections <= 0) publicSocketConnectionsByIp.delete(clientIdentifier);
        else publicSocketConnectionsByIp.set(clientIdentifier, nextIpConnections);
      };
      next();
    } catch {
      next(new Error("공개 퀴즈 연결 정책을 확인하지 못했습니다."));
    }
  });
  publicIo.on("connection", (socket: PublicSocket) => {
    socket.use(async (_packet, next) => {
      try {
        const policy = await getPlatformSecurityPolicy();
        const identity = socket.data.participantId
          ? `participant:${socket.data.participantId}`
          : `ip:${trustedClientIdentifier(socket.request.headers)}`;
        const decision = publicSocketEventLimiter(policy.publicQuizSocketEventsPerMinute).check(identity);
        next(decision.allowed ? undefined : new Error("실시간 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요."));
      } catch {
        next(new Error("실시간 요청 정책을 확인하지 못했습니다."));
      }
    });

    socket.on("session:join", async (payload: unknown, ack?: (res: unknown) => void) => {
      let rollback: { sessionId: string; participantId: string; presenceAdded: boolean } | null = null;
      try {
        const { sessionId } = parseSocketPayload(sessionSocketPayloadSchema, payload);
        if (socket.data.sessionId && socket.data.sessionId !== sessionId) {
          throw new Error("한 연결에서는 하나의 세션에만 입장할 수 있습니다.");
        }
        const session = await loadSessionForJoin(sessionId);
        if (!session || session.requiresLogin) throw new Error("공개 세션을 찾을 수 없습니다.");
        const cookies = parseCookieHeader(socket.request.headers.cookie ?? "");
        const participant = await findGuestParticipant(sessionId, cookies[guestCookieName(sessionId)] ?? null);
        if (!participant) throw new Error("공개 참여 화면에서 닉네임을 입력해 주세요.");
        if (participant.status === "KICKED") throw new Error("호스트가 이 세션에서 내보냈습니다.");

        const alreadyJoined = socket.data.sessionId === sessionId;
        if (!alreadyJoined) rollback = { sessionId, participantId: participant.id, presenceAdded: false };
        await socket.join(roomName(sessionId));

        const policy = await getPlatformSecurityPolicy();
        const presence = tryAddPresence(
          sessionId,
          participant.id,
          socket.id,
          policy.publicQuizSocketConnectionsPerParticipant,
        );
        if (!presence.allowed) throw new Error("이 참여자로 열린 퀴즈 화면이 너무 많습니다. 다른 탭을 닫고 다시 시도해 주세요.");
        if (rollback) rollback.presenceAdded = true;
        socket.data.sessionId = sessionId;
        socket.data.participantId = participant.id;
        const participantCount = presence.participantCount;
        emitToSessionHosts(io, sessionId, "participant:joined", {
          participantCount,
          participant: liveParticipantPayload(participant),
        });
        ensureLiveTimer(io, session);
        const currentQuestion = (session.livePhase === "QUESTION_ACTIVE" || session.livePhase === "QUESTION_REVEAL" || session.livePhase === "LEADERBOARD") && session.currentQuestionIndex !== null ? session.quiz.questions[session.currentQuestionIndex] : null;
        const [currentReveal, currentLeaderboard, finalLeaderboard] = await Promise.all([
          (session.livePhase === "QUESTION_REVEAL" || session.livePhase === "LEADERBOARD") && currentQuestion ? buildQuestionReveal(sessionId, currentQuestion) : Promise.resolve(null),
          session.livePhase === "LEADERBOARD" && currentQuestion ? buildLeaderboard(sessionId, currentQuestion.id) : Promise.resolve(null),
          session.status === "FINISHED" ? buildFinalLeaderboardForJoin(sessionId) : Promise.resolve(null),
        ]);
        const currentAnswerResult = currentReveal && currentQuestion ? await buildPersonalAnswerResult(sessionId, currentQuestion.id, participant.id) : null;
        const currentSequence = currentQuestion && currentQuestion.type !== "SLIDE" && session.livePhase === "QUESTION_ACTIVE" && session.currentQuestionStartedAt && session.currentQuestionStartedAt.getTime() > Date.now() ? buildQuestionSequencePayload(currentQuestion, session.quiz.questions.length, session.currentQuestionStartedAt) : null;
        ack?.({ ok: true, status: session.status, livePhase: session.livePhase, participantCount, currentQuestion: currentQuestion && session.currentQuestionStartedAt && !currentSequence ? publicQuestionPayload(currentQuestion, session.quiz.questions.length, session.quiz.answerPalette, session.currentQuestionStartedAt) : null, currentSequence, currentReveal, currentLeaderboard, currentAnswerResult, finalLeaderboard });
      } catch (error) {
        if (rollback) {
          try { await socket.leave(roomName(rollback.sessionId)); } catch { /* disconnect가 정리합니다. */ }
          if (rollback.presenceAdded) {
            const participantCount = removePresence(rollback.sessionId, rollback.participantId, socket.id);
            emitToSessionHosts(io, rollback.sessionId, "participant:left", { participantId: rollback.participantId, participantCount });
          }
          socket.data.sessionId = undefined;
          socket.data.participantId = undefined;
        }
        ack?.({ ok: false, error: error instanceof Error ? error.message : "공개 세션 입장에 실패했습니다." });
      }
    });

    socket.on("student:submit-answer", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const { sessionId, questionId, choiceId, choiceIds, textResponse } = parseSocketPayload(answerSocketPayloadSchema, payload);
        const { session, currentQuestion } = await loadAnswerContextForSubmission(sessionId);
        if (!session || session.requiresLogin) throw new Error("공개 세션을 찾을 수 없습니다.");
        if (!socket.data.participantId || socket.data.sessionId !== sessionId) throw new Error("먼저 공개 세션에 입장해 주세요.");
        if (session.status !== "IN_PROGRESS" || session.livePhase !== "QUESTION_ACTIVE") throw new Error("지금은 답을 제출할 수 없습니다.");
        if (!currentQuestion || currentQuestion.id !== questionId) throw new Error("이미 지나간 문항입니다.");
        if (currentQuestion.type === "SLIDE") throw new Error("콘텐츠 슬라이드는 답을 제출하지 않습니다.");
        if (!session.currentQuestionStartedAt || Date.now() < session.currentQuestionStartedAt.getTime()) throw new Error("문제가 아직 시작되지 않았습니다.");
        if (Date.now() >= session.currentQuestionStartedAt.getTime() + currentQuestion.timeLimitSec * 1000) throw new Error("응답 시간이 끝났습니다.");
        const responseTimeMs = session.currentQuestionStartedAt ? Date.now() - session.currentQuestionStartedAt.getTime() : null;
        await gradeAndRecordAnswer({ sessionId, participantId: socket.data.participantId, questionId, choiceId, choiceIds, textResponse, responseTimeMs, mode: "LIVE", question: currentQuestion });
        // 공개 namespace도 인증 namespace와 동일하게 정답 공개 전 결과를 노출하지 않습니다.
        ack?.({ ok: true });
        scheduleAnswerProgress(io, sessionId, questionId);
        if (isParticipationType(currentQuestion.type) && currentQuestion.revealResponsesLive) {
          scheduleParticipationSummary(io, sessionId, questionId);
        }
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "답을 제출하지 못했습니다." });
      }
    });

    socket.on("disconnect", () => {
      socket.data.releaseConnection?.();
      const { sessionId, participantId } = socket.data;
      if (!sessionId || !participantId) return;
      const participantCount = removePresence(sessionId, participantId, socket.id);
      emitToSessionHosts(io, sessionId, "participant:left", { participantId, participantCount });
    });
  });
}
