// 이 모듈은 socket-server.ts를 통해 커스텀 서버(server.ts, 순수 Node 런타임)에서도 로드되므로
// "server-only" 가드를 넣지 않습니다 — 어차피 API 라우트와 소켓 서버에서만 호출되고 클라이언트
// 컴포넌트에서 import될 일이 없습니다.
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { parseLikertValue } from "@/lib/quiz/likert";
import { isParticipationType } from "@/lib/quiz/participation";
import { isPinCorrect, parsePinAreas, parsePinPoint } from "@/lib/quiz/image-pin";
import { WORD_CLOUD_MAX_LENGTH } from "@/lib/quiz/word-cloud";

export function computeScore(params: {
  isCorrect: boolean;
  basePoints: number;
  mode: "LIVE" | "ASYNC";
  timeLimitSec: number;
  responseTimeMs: number | null;
}): number {
  if (!params.isCorrect) return 0;
  if (params.mode === "ASYNC") return params.basePoints;

  // LIVE는 응답 속도를 선형으로 반영합니다. 즉답은 100%, 제한시간 끝에는 30%까지 내려가
  // 같은 정답이라도 빠르게 판단한 학생이 순위에서 확실히 앞서도록 합니다.
  const limitMs = params.timeLimitSec * 1000;
  const elapsedMs = Math.min(params.responseTimeMs ?? limitMs, limitMs);
  const remainingRatio = Math.max(0, 1 - elapsedMs / limitMs);
  return Math.round(params.basePoints * (0.3 + 0.7 * remainingRatio));
}

export type GradeResult = { isCorrect: boolean; pointsAwarded: number; alreadyAnswered: boolean };

/** 보기(Choice) 대신 제출 원문을 textResponse에 담는 유형들. */
const TEXT_RESPONSE_TYPES = new Set(["SHORT_ANSWER", "ORDERING", "NUMERIC", "PIN_ANCHOR", "DROP_PIN", "WORD_CLOUD", "LIKERT"]);

// 대소문자·중복 공백 차이는 항상 관대하게 채점합니다(주관식 전용). 정답 목록·제출값 양쪽에 동일하게 적용.
export function normalizeAnswerText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isShortAnswerCorrect(textResponse: string | null, acceptedAnswers: string[]): boolean {
  if (!textResponse || textResponse.trim().length === 0) return false;
  const normalized = normalizeAnswerText(textResponse);
  return acceptedAnswers.some((accepted) => normalizeAnswerText(accepted) === normalized);
}

function parseOrderingResponse(textResponse: string | null): string[] {
  if (!textResponse) return [];
  try {
    const parsed: unknown = JSON.parse(textResponse);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function sameStringSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return leftSet.size === right.length && right.every((value) => leftSet.has(value));
}

function isDuplicateAnswerError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.includes("participantId") && target.includes("questionId");
  // PostgreSQL/Prisma 버전에 따라 constraint 이름 문자열로 내려올 수 있습니다. 이 트랜잭션에서
  // 새로 만드는 유니크 행은 Answer 하나뿐이라 target이 없는 P2002도 아래 재조회로 최종 확인합니다.
  return typeof target !== "string" || target.includes("participantId_questionId");
}

async function loadGradingQuestion(questionId: string) {
  return getPrisma().question.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      type: true,
      points: true,
      timeLimitSec: true,
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
}

export type GradingQuestion = NonNullable<Awaited<ReturnType<typeof loadGradingQuestion>>>;

export async function gradeAndRecordAnswer(params: {
  sessionId: string;
  participantId: string;
  questionId: string;
  choiceId: string | null;
  choiceIds?: string[];
  textResponse?: string | null;
  responseTimeMs: number | null;
  mode: "LIVE" | "ASYNC";
  /** 호출부가 현재 문항임을 이미 검증했다면 같은 문항 SELECT를 채점기에서 반복하지 않습니다. */
  question?: GradingQuestion;
}): Promise<GradeResult> {
  const prisma = getPrisma();

  // @@unique([participantId, questionId])로 재제출을 막습니다 — 이미 있으면 채점 없이 기존 결과를 반환.
  const existing = await prisma.answer.findUnique({
    where: { participantId_questionId: { participantId: params.participantId, questionId: params.questionId } },
  });
  if (existing) {
    return { isCorrect: existing.isCorrect, pointsAwarded: existing.pointsAwarded, alreadyAnswered: true };
  }

  const question = params.question ?? await loadGradingQuestion(params.questionId);
  if (!question || question.id !== params.questionId) throw new Error("문항을 찾을 수 없습니다.");

  const selectedChoiceIds = [...new Set(params.choiceIds?.length ? params.choiceIds : params.choiceId ? [params.choiceId] : [])];
  if (selectedChoiceIds.some((choiceId) => !question.choices.some((choice) => choice.id === choiceId))) {
    throw new Error("이 문항에 속하지 않은 보기입니다.");
  }

  let isCorrect = false;
  let correctnessRatio = 0;
  if (question.type === "SLIDE") {
    isCorrect = true;
  } else if (question.type === "SHORT_ANSWER") {
    isCorrect = isShortAnswerCorrect(params.textResponse ?? null, question.acceptedAnswers);
    correctnessRatio = isCorrect ? 1 : 0;
  } else if (question.type === "ORDERING") {
    const submitted = parseOrderingResponse(params.textResponse ?? null).map(normalizeAnswerText);
    const correct = question.orderedItems.map(normalizeAnswerText);
    isCorrect = submitted.length === correct.length && submitted.every((item, index) => item === correct[index]);
    correctnessRatio = isCorrect ? 1 : 0;
  } else if (question.type === "NUMERIC") {
    const submitted = Number(params.textResponse);
    if (!Number.isFinite(submitted) || question.numericMin === null || question.numericMax === null || question.numericAnswer === null) {
      throw new Error("유효한 숫자 답안을 제출해 주세요.");
    }
    if (submitted < question.numericMin || submitted > question.numericMax) throw new Error("답안은 문제의 숫자 범위 안에 있어야 합니다.");
    const range = question.numericMax - question.numericMin;
    const distance = Math.abs(submitted - question.numericAnswer);
    correctnessRatio = Math.max(0, 1 - distance / Math.max(Math.abs(range), Number.EPSILON));
    isCorrect = distance <= Math.max(Math.abs(range) * 0.005, Number.EPSILON);
  } else if (question.type === "PIN_ANCHOR") {
    // 정답 영역 안이면 만점, 밖이면 0점입니다. NUMERIC처럼 "가까울수록 부분점수"를 주려면
    // 영역 경계까지의 거리를 재야 하는데, 자유형 다각형에서는 그 거리가 직관과 어긋납니다.
    const point = parsePinPoint(params.textResponse ?? null);
    if (!point) throw new Error("이미지 위에 핀을 놓아 주세요.");
    isCorrect = isPinCorrect(point, parsePinAreas(question.pinAreas));
    correctnessRatio = isCorrect ? 1 : 0;
  } else if (question.type === "SURVEY") {
    if (selectedChoiceIds.length !== 1) throw new Error("설문 보기를 하나 선택해 주세요.");
    isCorrect = true;
    correctnessRatio = 1;
  } else if (question.type === "WORD_CLOUD") {
    const text = params.textResponse?.trim() ?? "";
    if (!text) throw new Error("한 단어 이상 입력해 주세요.");
    if (text.length > WORD_CLOUD_MAX_LENGTH) throw new Error(`${WORD_CLOUD_MAX_LENGTH}자 이내로 입력해 주세요.`);
    isCorrect = true;
  } else if (question.type === "DROP_PIN") {
    if (!parsePinPoint(params.textResponse ?? null)) throw new Error("이미지 위에 핀을 놓아 주세요.");
    isCorrect = true;
  } else if (question.type === "LIKERT") {
    if (parseLikertValue(params.textResponse ?? null, question.likertSteps ?? 0) === null) {
      throw new Error("척도에서 하나를 선택해 주세요.");
    }
    isCorrect = true;
  } else {
    if ((question.type === "SINGLE_CHOICE" || question.type === "TRUE_FALSE") && !question.multipleSelection && selectedChoiceIds.length !== 1) {
      throw new Error("이 문항에서는 답을 하나만 선택해 주세요.");
    }
    if (question.type === "SINGLE_CHOICE" && question.multipleSelection && selectedChoiceIds.length < 1) {
      throw new Error("답을 한 개 이상 선택해 주세요.");
    }
    const correctChoiceIds = question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.id);
    isCorrect = sameStringSet(selectedChoiceIds, correctChoiceIds);
    correctnessRatio = isCorrect ? 1 : 0;
  }

  // 참여형(설문·워드클라우드·드롭핀·리커트)은 정답이 없으므로 점수를 만들지 않습니다 — 참여
  // 기록(isCorrect)만 남기고 응답 분포로만 결과를 보여줍니다. 점수를 주면 리더보드가 참여형
  // 응답 속도로 뒤집힙니다.
  const pointsAwarded = isParticipationType(question.type) ? 0 : computeScore({
    isCorrect: correctnessRatio > 0,
    basePoints: Math.round(question.points * correctnessRatio),
    mode: params.mode,
    timeLimitSec: question.timeLimitSec,
    responseTimeMs: params.responseTimeMs,
  });

  try {
    await prisma.$transaction([
      prisma.answer.create({
        data: {
          sessionId: params.sessionId,
          participantId: params.participantId,
          questionId: params.questionId,
          choiceId: selectedChoiceIds.length === 1 ? selectedChoiceIds[0] : null,
          selectedChoiceIds,
          selectedChoiceTexts: selectedChoiceIds.map((choiceId) => question.choices.find((choice) => choice.id === choiceId)?.text).filter((text): text is string => Boolean(text)),
          // 보기 선택이 아닌 유형은 제출 원문을 그대로 남깁니다. 핀은 좌표 JSON, 리커트는 눈금
          // 번호, 워드클라우드는 입력 문장이 여기에 들어갑니다.
          textResponse: TEXT_RESPONSE_TYPES.has(question.type) ? (params.textResponse ?? null) : null,
          isCorrect,
          responseTimeMs: params.responseTimeMs,
          pointsAwarded,
        },
      }),
      prisma.sessionParticipant.update({
        where: { id: params.participantId },
        data: { score: { increment: pointsAwarded } },
      }),
    ]);
  } catch (error) {
    if (!isDuplicateAnswerError(error)) throw error;
    // 같은 문항의 병렬 제출에서 진 요청입니다. 승자 트랜잭션의 결과를 돌려주면 점수는 한 번만
    // 증가하고 HTTP·Socket 호출부는 네트워크 재시도를 정상 성공으로 처리할 수 있습니다.
    const winner = await prisma.answer.findUnique({
      where: { participantId_questionId: { participantId: params.participantId, questionId: params.questionId } },
      select: { isCorrect: true, pointsAwarded: true },
    });
    if (!winner) throw error;
    return { ...winner, alreadyAnswered: true };
  }

  return { isCorrect, pointsAwarded, alreadyAnswered: false };
}
