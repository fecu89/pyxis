"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { QUIZ_NAMESPACE, QUIZ_PUBLIC_NAMESPACE, SOCKET_PATH } from "@/lib/realtime/namespaces";
import { Circle, Diamond, Hexagon, Square, Star, Triangle } from "lucide-react";
import { CheckIcon, HistoryIcon, SessionIcon, XIcon } from "@/components/ui/icons";
import {
  CountdownRing,
  ContentSlide,
  FinalPodium,
  LiveGameSurface,
  PersonalResultCard,
  PointMultiplierBadge,
  PointMultiplierIntro,
  QuestionMedia,
  QuestionSequenceStage,
  SubmissionWaiting,
  type AnswerPalette,
  type LiveQuestionIntro,
  type LiveQuestionPayload,
  type LiveQuestionReveal,
  type QuizQuestionPayload,
} from "@/components/quiz/live-game-ui";
import { LiveLeaderboard, type Leaderboard } from "@/components/quiz/live-leaderboard";
import { QuizLiveAudioController } from "@/components/quiz/live-audio-controller";
import { NumericDial } from "@/components/quiz/numeric-dial";
import { ParticipationSummaryView } from "@/components/quiz/participation-views";
import { PinDistribution, ImagePinAnswer } from "@/components/quiz/image-pin";
import { SortableOrderAnswer } from "@/components/quiz/sortable-order-answer";
import { StatusBadge } from "@/components/ui/data-display";
import { LoadingCard, ProgressBar } from "@/components/ui/feedback";
import { clampLikertSteps } from "@/lib/quiz/likert";
import { snapNumericValue } from "@/lib/quiz/numeric";
import { isParticipationType, isPinType } from "@/lib/quiz/participation";
import { serializePinPoint } from "@/lib/quiz/image-pin";
import { hasPointMultiplierIntro, POINT_MULTIPLIER_INTRO_MS, pointMultiplier } from "@/lib/quiz/point-multiplier";
import type { QuestionSequencePayload } from "@/lib/quiz/question-sequence";
import { WORD_CLOUD_MAX_LENGTH } from "@/lib/quiz/word-cloud";
import type { QuizLiveAudioSettings } from "@/lib/quiz/live-audio-shape";

export type AnswerPayload = { choiceId: string | null; choiceIds?: string[]; textResponse?: string };

// 편집기와 동일한 pad 역할 토큰 팔레트입니다.
const ANSWER_PALETTES: Record<AnswerPalette, string[]> = {
  BRAND: ["bg-brand-600 text-on-brand", "bg-danger-500 text-on-brand", "bg-info-600 text-on-brand", "bg-warning-400 text-warning-950", "bg-accent-soft-fg text-on-brand", "bg-success-soft-fg text-on-brand"],
  SOFT: ["bg-brand-soft text-brand-soft-fg", "bg-danger-soft text-danger-soft-fg", "bg-info-soft text-info-soft-fg", "bg-warning-soft text-warning-soft-fg", "bg-accent-soft text-accent-soft-fg", "bg-success-soft text-success-soft-fg"],
  FOREST: ["bg-brand-900 text-on-brand", "bg-brand-700 text-on-brand", "bg-brand-500 text-on-brand", "bg-info-300 text-brand-950", "bg-info-600 text-white", "bg-brand-200 text-brand-950"],
};

const PLAY_ANSWER_ICONS = [Triangle, Diamond, Circle, Square, Star, Hexagon];

export function PlaySession({ sessionId, initialSession, audioSettings, publicAccess = false }: {
  sessionId: string;
  initialSession: { mode: "LIVE" | "ASYNC"; status?: string; livePhase?: string | null; quiz: { title: string } };
  audioSettings: QuizLiveAudioSettings;
  publicAccess?: boolean;
}) {
  const mode = initialSession.mode;
  const quizTitle = initialSession.quiz.title || "퀴즈";
  if (mode === "LIVE") return <LivePlay sessionId={sessionId} quizTitle={quizTitle} initialStatus={initialSession.status} initialPhase={initialSession.livePhase} audioSettings={audioSettings} publicAccess={publicAccess} />;
  if (mode === "ASYNC") return <AsyncPlay sessionId={sessionId} quizTitle={quizTitle} publicAccess={publicAccess} />;
  return null;
}

function LivePlay({ sessionId, quizTitle, initialStatus, initialPhase, audioSettings, publicAccess }: { sessionId: string; quizTitle: string; initialStatus?: string; initialPhase?: string | null; audioSettings: QuizLiveAudioSettings; publicAccess: boolean }) {
  const socketRef = useRef<Socket | null>(null);
  const [sequence, setSequence] = useState<QuestionSequencePayload | null>(null);
  const [question, setQuestion] = useState<LiveQuestionPayload | null>(null);
  const [reveal, setReveal] = useState<LiveQuestionReveal | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [ackResult, setAckResult] = useState<{ isCorrect: boolean; pointsAwarded: number } | null>(null);
  const [phase, setPhase] = useState<string | null>(initialPhase ?? "LOBBY");
  const [ended, setEnded] = useState(initialStatus === "FINISHED");
  const [finalLeaderboard, setFinalLeaderboard] = useState<Leaderboard>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [quizStartSignal, setQuizStartSignal] = useState(0);
  const [leaderboardSignal, setLeaderboardSignal] = useState(0);
  const [finishSignal, setFinishSignal] = useState(0);

  useEffect(() => {
    let active = true;
    let connectedSocket: Socket | null = null;
    void import("socket.io-client").then(({ io }) => {
      if (!active) return;
      let firstQuestionAnnounced = false;
      const socket = io(publicAccess ? QUIZ_PUBLIC_NAMESPACE : QUIZ_NAMESPACE, { path: SOCKET_PATH });
      connectedSocket = socket;
      socketRef.current = socket;
      // 다른 앱을 보다 돌아오면 소켓이 새로 붙는데, 그때 서버 방(room) 멤버십이 사라져 있습니다.
      // 재연결마다 다시 입장하고, 자리 비운 사이 넘어간 단계를 스냅샷으로 전부 다시 그립니다.
      const joinSession = () => {
        socket.emit("session:join", { sessionId }, (response: { ok: boolean; error?: string; status?: string; livePhase?: string | null; currentQuestion?: LiveQuestionPayload | null; currentSequence?: QuestionSequencePayload | null; currentReveal?: LiveQuestionReveal | null; currentLeaderboard?: Leaderboard | null; currentAnswerResult?: { questionId: string; isCorrect: boolean; pointsAwarded: number } | null; finalLeaderboard?: Leaderboard | null }) => {
          if (!active) return;
          if (!response.ok) {
            setError(response.error ?? "세션에 입장하지 못했습니다.");
            return;
          }
          setError(null);
          if (response.status === "FINISHED") {
            setFinalLeaderboard(response.finalLeaderboard ?? []);
            setPhase("ENDED");
            setEnded(true);
            return;
          }
          if ((response.currentSequence ?? response.currentQuestion)?.questionIndex === 0) firstQuestionAnnounced = true;
          setPhase(response.livePhase ?? null);
          setSequence(response.currentSequence ?? null);
          setQuestion(response.currentSequence ? null : response.currentQuestion ?? null);
          setReveal(response.currentReveal ?? null);
          setLeaderboard(response.currentLeaderboard ?? null);
          setSubmitted(Boolean(response.currentAnswerResult));
          setAckResult(response.currentAnswerResult ?? null);
        });
      };
      socket.on("connect", () => { setConnected(true); setError(null); joinSession(); });
      socket.on("disconnect", () => setConnected(false));
      socket.on("connect_error", () => setError("실시간 연결이 끊겼습니다. 자동으로 다시 연결하고 있어요."));
      const announceFirstQuestion = (questionIndex: number) => {
        if (questionIndex !== 0 || firstQuestionAnnounced) return;
        firstQuestionAnnounced = true;
        setQuizStartSignal((current) => current + 1);
      };
      socket.on("question:sequence", (payload: QuestionSequencePayload) => {
        announceFirstQuestion(payload.questionIndex);
        setSequence(payload);
        setQuestion(null);
        setReveal(null);
        setLeaderboard(null);
        setSubmitted(false);
        setAckResult(null);
        setError(null);
        setPhase("QUESTION_SEQUENCE");
      });
      socket.on("question:show", (payload: LiveQuestionPayload) => {
        announceFirstQuestion(payload.questionIndex);
        setSequence(null);
        setQuestion(payload);
        setReveal(null);
        setLeaderboard(null);
        setSubmitted(false);
        setAckResult(null);
        setError(null);
        setPhase("QUESTION_ACTIVE");
      });
      socket.on("question:reveal", (payload: LiveQuestionReveal) => {
        setReveal(payload);
        setLeaderboard(null);
        setPhase("QUESTION_REVEAL");
      });
      socket.on("answer:result", ({ isCorrect, pointsAwarded }: { questionId: string; isCorrect: boolean; pointsAwarded: number }) => {
        setSubmitted(true);
        setAckResult({ isCorrect, pointsAwarded });
      });
      socket.on("leaderboard:show", ({ leaderboard: entries }: { questionId: string; leaderboard: Leaderboard }) => {
        setLeaderboard(entries);
        setPhase("LEADERBOARD");
        if (entries.length > 0) setLeaderboardSignal((current) => current + 1);
      });
      socket.on("session:ended", ({ finalLeaderboard: entries }: { finalLeaderboard: Leaderboard }) => {
        setFinalLeaderboard(entries ?? []);
        setEnded(true);
        setPhase("ENDED");
        setFinishSignal((current) => current + 1);
      });
      socket.on("kicked", () => setError("호스트가 이 세션에서 내보냈습니다."));
    }).catch(() => {
      if (active) setError("실시간 모듈을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.");
    });
    return () => {
      active = false;
      connectedSocket?.disconnect();
      if (socketRef.current === connectedSocket) socketRef.current = null;
    };
  }, [publicAccess, sessionId]);

  function submit(payload: AnswerPayload) {
    if (!question || submitted) return;
    setSubmitted(true);
    setError(null);
    socketRef.current?.emit("student:submit-answer", { sessionId, questionId: question.questionId, ...payload }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) {
        setError(response.error ?? "답을 제출하지 못했습니다.");
        setSubmitted(false);
      }
    });
  }

  if (ended) return (
    <QuizLiveAudioController settings={audioSettings} scene="ENDED" sequence={null} quizStartSignal={quizStartSignal} leaderboardSignal={leaderboardSignal} leaderboardActive={false} finishSignal={finishSignal} hasFinalPodium={finalLeaderboard.length > 0}>
      <CompletionScreen sessionId={sessionId} leaderboard={finalLeaderboard} publicAccess={publicAccess} />
    </QuizLiveAudioController>
  );

  const progress = question ?? sequence;
  return (
    <QuizLiveAudioController settings={audioSettings} scene={phase === "LOBBY" ? "LOBBY" : "GAME"} sequence={sequence} quizStartSignal={quizStartSignal} leaderboardSignal={leaderboardSignal} leaderboardActive={phase === "LEADERBOARD" && Boolean(leaderboard)} finishSignal={finishSignal} hasFinalPodium={false}>
      <LiveGameSurface fit contentClassName="min-h-0 overflow-hidden px-3 py-2 sm:px-5 sm:py-3 lg:px-6">
      {/* 남은 문제 수는 화면 맨 위에 붙인 진행 바 하나로 보여줍니다 — 모바일 상단 공간 절약. */}
      {progress ? <div className="absolute inset-x-0 top-0 z-30 h-1 bg-white/10" aria-hidden="true"><div className="h-full bg-info-300 transition-all duration-500" style={{ width: `${((progress.questionIndex + 1) / progress.totalQuestions) * 100}%` }} /></div> : null}
      <PlayerStageHeader title={quizTitle} connected={connected} question={question ?? sequence} />
      {error ? <div className="mb-2 rounded-xl border border-danger-300/30 bg-danger-400/15 px-3 py-2 text-xs font-bold text-danger-100" role="alert">{error}</div> : null}

      {sequence ? (
        <QuestionSequenceStage sequence={sequence} />
      ) : !question ? (
        <section className="grid flex-1 place-items-center rounded-[32px] border border-white/10 bg-white/[0.07] p-8 text-center backdrop-blur-sm">
          <div>
            <div className="relative mx-auto grid h-24 w-24 place-items-center rounded-full bg-info-300 text-brand-950 shadow-2xl shadow-info-300/20">
              <SessionIcon className="h-10 w-10" />
              <span className="absolute inset-0 animate-ping rounded-full border border-info-300/50" aria-hidden="true" />
            </div>
            <p className="mt-7 text-xs font-black uppercase tracking-[0.24em] text-info-200">Ready to play</p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">호스트를 기다리고 있어요</h1>
            <p className="mt-3 text-sm font-bold text-brand-100/60">곧 첫 문제가 시작됩니다. 이 화면을 열어 두세요.</p>
            <div className="mx-auto mt-6 flex w-fit gap-2" aria-hidden="true"><span className="game-wait-dot" /><span className="game-wait-dot [animation-delay:160ms]" /><span className="game-wait-dot [animation-delay:320ms]" /></div>
          </div>
        </section>
      ) : leaderboard ? (
        <section key={`${question.questionId}-board`} className="animate-game-pop grid flex-1 place-items-center py-4">
          <div className="w-full max-w-4xl">
            <LiveLeaderboard entries={leaderboard} title="현재 TOP 3" variant="stage" />
            <p className="mt-6 text-center text-xs font-bold text-brand-100/50">다음 문제를 준비하고 있어요</p>
          </div>
        </section>
      ) : reveal ? (
        <PlayerRevealStage key={`${question.questionId}-reveal`} question={question} reveal={reveal} submitted={submitted} result={ackResult} />
      ) : submitted ? (
        <section className="grid flex-1 place-items-center py-5"><div className="w-full max-w-2xl"><SubmissionWaiting /></div></section>
      ) : (
        <PlayerQuestionStage key={question.questionId} question={question} onSubmit={submit} />
      )}
      </LiveGameSurface>
    </QuizLiveAudioController>
  );
}

// 모바일에서는 숨깁니다 — 제목·문항 수 같은 부가 정보가 좁은 화면 상단을 차지할 필요가 없고,
// 진행도는 화면 맨 위의 진행 바가 대신합니다. 연결 상태는 끊겼을 때의 에러 배너로 충분합니다.
function PlayerStageHeader({ title, connected, question }: { title: string; connected: boolean; question: Pick<QuizQuestionPayload, "questionIndex" | "totalQuestions"> | null }) {
  return (
    <header className="mb-2 hidden min-h-9 items-center justify-between gap-3 px-1 sm:flex" aria-label="퀴즈 진행 상태">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-info-300" : "animate-pulse bg-warning-300"}`} aria-hidden="true" />
        <p className="truncate text-xs font-black text-brand-100/75">{title}</p>
      </div>
      {question ? <p className="shrink-0 font-mono text-[11px] font-black text-brand-100/50">{question.questionIndex + 1} / {question.totalQuestions}</p> : <p className="shrink-0 text-[10px] font-black text-brand-100/40">대기 중</p>}
    </header>
  );
}

// 편집기 미리보기도 이 컴포넌트를 그대로 씁니다 — 미리보기가 실제 학생 화면과 어긋나지 않게.
// 문제 유형 배지·문항 수·제목은 참가자에겐 부가 정보라 빼고, 진행도는 상위의 최상단 진행 바가 맡습니다.
export function PlayerQuestionStage({ question, onSubmit }: { question: LiveQuestionPayload; onSubmit: (payload: AnswerPayload) => void }) {
  // 슬라이드는 타이머 없이 호스트가 넘길 때까지 감상합니다.
  if (question.type === "SLIDE") return <section className="animate-game-pop flex flex-1 flex-col pt-2"><ContentSlide question={question} className="flex-1" /><p className="mt-2 text-center text-[11px] font-bold text-brand-100/45">선생님이 다음 문제로 넘겨줄 거예요</p></section>;
  // 핀 유형은 답안 영역이 곧 이미지입니다. 왼쪽에 같은 이미지를 한 번 더 띄우면 화면에 두 번
  // 나오고, 좁은 오른쪽 칸에 갇힌 이미지로는 핀을 정확히 놓기도 어렵습니다 — 한 단으로 폅니다.
  const pin = isPinType(question.type);
  return (
    <section className="animate-game-pop flex min-h-0 flex-1 flex-col overflow-hidden pt-1">
      <div className={`grid min-h-0 flex-1 gap-3 lg:items-center lg:gap-5 ${pin ? "grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-1" : "content-center lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]"}`}>
        <div className="flex shrink-0 flex-col items-start text-left">
          <PointMultiplierBadge points={question.points} />
          <div className="mt-3 flex w-full items-center gap-3 lg:items-start lg:gap-4">
            <CountdownRing startedAt={question.startedAt} seconds={question.timeLimitSec} size="small" />
            {/* 작은 화면에서는 폭에 비례해 줄어드는 유동 크기 — 고정 text-2xl은 소형 폰에서 화면을 넘겼습니다. */}
            <h1 className="max-w-4xl flex-1 whitespace-pre-wrap text-[clamp(1.15rem,4.6vw,1.5rem)] font-black leading-[1.14] tracking-[-0.04em] sm:text-4xl lg:text-5xl">{question.text}</h1>
          </div>
          {pin ? null : <QuestionMedia question={question} className="mt-3 w-full max-w-sm" />}
        </div>
        <div className={`rounded-[24px] border border-white/10 bg-white/[0.06] p-2 shadow-2xl backdrop-blur-sm sm:p-4 ${pin ? "mx-auto h-full min-h-0 w-full max-w-2xl overflow-hidden" : ""}`}>
          <AnswerInput question={question} disabled={false} onSubmit={onSubmit} variant="game" />
        </div>
      </div>
    </section>
  );
}

function PlayerRevealStage({ question, reveal, submitted, result }: { question: LiveQuestionPayload; reveal: LiveQuestionReveal; submitted: boolean; result: { isCorrect: boolean; pointsAwarded: number } | null }) {
  if (reveal.type === "SLIDE") return <section className="animate-game-pop flex flex-1 items-center py-3"><ContentSlide question={question} className="w-full" /></section>;
  const answer = revealAnswerLabel(question, reveal);
  return (
    <section className="animate-game-pop grid min-h-0 flex-1 items-center gap-5 overflow-hidden py-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.7fr)]">
      <div className="relative overflow-hidden rounded-[32px] border border-info-300/25 bg-info-300 p-6 text-center text-brand-950 shadow-2xl shadow-info-300/10 sm:p-9">
        <div className="absolute inset-x-0 top-0 h-1 bg-white/70" aria-hidden="true" />
        <p className="text-xs font-black uppercase tracking-[0.24em] text-brand-800/70">Correct answer</p>
        <h1 className="mx-auto mt-5 max-w-3xl whitespace-pre-wrap text-3xl font-black leading-tight tracking-[-0.04em] sm:text-5xl">{answer}</h1>
        <RevealBreakdown question={question} reveal={reveal} />
      </div>
      <div>
        {isParticipationType(question.type) ? (
          <section className="animate-result-bounce rounded-[30px] border border-info-300/30 bg-info-400/15 p-6 text-center" aria-live="polite">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white/90 shadow-lg"><CheckIcon className="h-7 w-7 text-info-700" /></span>
            <p className="mt-4 text-2xl font-black">참여 완료!</p>
            <p className="mt-2 text-sm font-bold text-brand-100/70">점수가 없는 문항이에요. 모두의 응답을 확인해 보세요.</p>
          </section>
        ) : (
          <PersonalResultCard result={result} submitted={submitted} />
        )}
      </div>
    </section>
  );
}

const PARTICIPATION_REVEAL_TITLES: Record<string, string> = {
  SURVEY: "모두의 선택",
  WORD_CLOUD: "모두가 떠올린 단어",
  DROP_PIN: "모두가 놓은 핀",
  LIKERT: "모두의 응답",
};

function revealAnswerLabel(question: QuizQuestionPayload, reveal: LiveQuestionReveal) {
  if (reveal.type === "SLIDE") return question.text;
  if (reveal.type === "SHORT_ANSWER") return reveal.acceptedAnswers.join(" / ") || "허용 정답 없음";
  if (reveal.type === "ORDERING") return reveal.correctOrder.join(" → ");
  if (reveal.type === "NUMERIC") return reveal.numericAnswer === null ? "정답 없음" : String(reveal.numericAnswer);
  if (reveal.type === "PIN_ANCHOR") return "정답 위치";
  if (reveal.type !== "SINGLE_CHOICE" && reveal.type !== "TRUE_FALSE") return PARTICIPATION_REVEAL_TITLES[reveal.type] ?? "모두의 응답";
  return reveal.correctChoiceIds.map((id) => question.choices.find((choice) => choice.id === id)?.text).filter(Boolean).join(" / ") || "정답 없음";
}

function RevealBreakdown({ question, reveal }: { question: QuizQuestionPayload; reveal: LiveQuestionReveal }) {
  // 설문은 보기 분포라 객관식과 같은 막대 UI를 씁니다. 나머지 참여형은 유형 전용 화면입니다.
  if (reveal.type === "SURVEY" && reveal.summary?.type === "SURVEY") {
    const total = Math.max(1, reveal.summary.choiceBreakdown.reduce((sum, item) => sum + item.count, 0));
    return (
      <div className="mx-auto mt-7 grid max-w-2xl gap-2 text-left sm:grid-cols-2">
        {reveal.summary.choiceBreakdown.map((item) => {
          const choice = question.choices.find((candidate) => candidate.id === item.choiceId);
          return <div key={item.choiceId} className="rounded-xl bg-brand-950/10 p-3"><div className="flex items-center justify-between gap-3 text-xs font-black"><span className="truncate">{choice?.text}</span><span>{item.count}명</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/50"><div className="h-full origin-left animate-[answer-bar_700ms_ease-out_both] rounded-full bg-brand-700" style={{ width: `${(item.count / total) * 100}%` }} /></div></div>;
        })}
      </div>
    );
  }
  if (reveal.type === "WORD_CLOUD" || reveal.type === "DROP_PIN" || reveal.type === "LIKERT") {
    return <ParticipationSummaryView summary={reveal.summary} question={question} variant="light" className="mx-auto mt-7 max-w-2xl" />;
  }
  if (reveal.type === "PIN_ANCHOR") {
    return (
      <div className="mx-auto mt-7 max-w-2xl">
        {question.imageUrl ? <PinDistribution imageUrl={question.imageUrl} imageAlt={question.imageAlt ?? null} pins={reveal.pins} areas={reveal.pinAreas} emphasizeAreas fit className="h-[min(30dvh,17rem)]" /> : null}
        <p className="mt-3 text-sm font-black text-brand-900/65">{reveal.correctCount} / {reveal.totalAnswered}명이 영역 안에 놓았어요</p>
      </div>
    );
  }
  if (reveal.type === "SINGLE_CHOICE" || reveal.type === "TRUE_FALSE") {
    const total = Math.max(1, reveal.choiceBreakdown.reduce((sum, item) => sum + item.count, 0));
    return (
      <div className="mx-auto mt-7 grid max-w-2xl gap-2 text-left sm:grid-cols-2">
        {reveal.choiceBreakdown.map((item) => {
          const choice = question.choices.find((candidate) => candidate.id === item.choiceId);
          const correct = reveal.correctChoiceIds.includes(item.choiceId);
          return <div key={item.choiceId} className="rounded-xl bg-brand-950/10 p-3"><div className="flex items-center justify-between gap-3 text-xs font-black"><span className="truncate">{choice?.text}</span><span>{item.count}명</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white/50"><div className={`h-full origin-left animate-[answer-bar_700ms_ease-out_both] rounded-full ${correct ? "bg-brand-800" : "bg-brand-600/45"}`} style={{ width: `${(item.count / total) * 100}%` }} /></div></div>;
        })}
      </div>
    );
  }
  if ("correctCount" in reveal) return <p className="mt-6 text-sm font-black text-brand-900/65">{reveal.correctCount} / {reveal.totalAnswered}명 정답</p>;
  return null;
}

function AnswerInput({ question, disabled, onSubmit, variant = "light" }: { question: QuizQuestionPayload; disabled: boolean; onSubmit: (payload: AnswerPayload) => void; variant?: "game" | "light" }) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const palette = ANSWER_PALETTES[question.answerPalette] ?? ANSWER_PALETTES.BRAND;
  const numericMin = question.numericMin ?? 0;
  const numericMax = question.numericMax ?? 100;
  // 눈금은 서버가 범위·정답에서 계산해 내려보냅니다(lib/quiz/numeric.ts). NUMERIC이 아니면 null입니다.
  const numericStep = question.numericStep ?? 1;
  const [numericValue, setNumericValue] = useState(() => String(snapNumericValue((numericMin + numericMax) / 2, numericMin, numericMax, numericStep)));
  const game = variant === "game";

  if (question.type === "SHORT_ANSWER") {
    return <form onSubmit={(event) => { event.preventDefault(); onSubmit({ choiceId: null, textResponse: text.trim() }); }} className="mx-auto w-full max-w-2xl"><label htmlFor={`answer-${question.questionId}`} className={`mb-3 block text-center text-xs font-black ${game ? "text-brand-100/60" : "text-content-muted"}`}>정답을 직접 입력하세요</label><input id={`answer-${question.questionId}`} value={text} onChange={(event) => setText(event.target.value)} disabled={disabled} required maxLength={500} autoComplete="off" enterKeyHint="send" placeholder="정답 입력" className={`h-[clamp(3.4rem,13vw,5rem)] w-full rounded-2xl border-2 px-5 text-center text-[clamp(1rem,4.2vw,1.25rem)] font-black outline-none transition placeholder:font-medium disabled:opacity-60 ${game ? "border-white/15 bg-white/10 text-white placeholder:text-white/30 focus:border-info-300 focus:bg-white/15" : "border-line bg-surface-muted text-content placeholder:text-content-subtle focus:border-brand-500 focus:bg-white"}`} /><SubmitAnswerButton disabled={disabled || !text.trim()} variant={variant} /></form>;
  }

  if (question.type === "NUMERIC") {
    // 직접 입력을 없앤 다이얼 방식입니다 — 숫자를 칠 수 있으면 단답형과 다를 게 없어서,
    // 중앙 마커 아래 눈금 띠를 드래그(관성 포함)해서만 값을 고릅니다.
    return <form onSubmit={(event) => { event.preventDefault(); onSubmit({ choiceId: null, textResponse: String(snapNumericValue(Number(numericValue), numericMin, numericMax, numericStep)) }); }} className={`mx-auto w-full max-w-2xl rounded-[24px] p-4 sm:p-5 ${game ? "bg-white/[0.07]" : "bg-surface-muted"}`}><NumericDial min={numericMin} max={numericMax} step={numericStep} disabled={disabled} variant={variant} defaultValue={Number(numericValue)} onValueChange={(value) => setNumericValue(String(value))} /><SubmitAnswerButton disabled={disabled || numericValue === ""} variant={variant} /></form>;
  }

  if (question.type === "ORDERING") {
    return <SortableOrderAnswer items={question.orderedItems} disabled={disabled} variant={variant} onSubmit={(orderedItems) => onSubmit({ choiceId: null, textResponse: JSON.stringify(orderedItems) })} />;
  }

  // 핀 유형은 채점형(PIN_ANCHOR)과 참여형(DROP_PIN)이 입력 방식을 그대로 공유합니다.
  // 원형 정답 영역 판정에 필요하므로 학생 화면이 실제로 그린 이미지 비율을 함께 보냅니다.
  if (question.type === "PIN_ANCHOR" || question.type === "DROP_PIN") {
    if (!question.imageUrl) return <div className={`rounded-2xl p-5 text-center text-sm font-bold ${game ? "bg-white/10 text-brand-100/60" : "bg-surface-muted text-content-muted"}`}>이 문항에 등록된 이미지가 없습니다.</div>;
    return <ImagePinAnswer imageUrl={question.imageUrl} imageAlt={question.imageAlt ?? null} disabled={disabled} variant={variant} onSubmit={(point) => onSubmit({ choiceId: null, textResponse: serializePinPoint(point) })} />;
  }

  if (question.type === "WORD_CLOUD") {
    return (
      <form onSubmit={(event) => { event.preventDefault(); onSubmit({ choiceId: null, textResponse: text.trim() }); }} className="mx-auto w-full max-w-2xl">
        <label htmlFor={`answer-${question.questionId}`} className={`mb-3 block text-center text-xs font-black ${game ? "text-brand-100/60" : "text-content-muted"}`}>떠오르는 단어를 자유롭게 적어 주세요</label>
        <textarea
          id={`answer-${question.questionId}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={disabled}
          required
          rows={3}
          maxLength={WORD_CLOUD_MAX_LENGTH}
          placeholder="예) 광합성, 엽록체, 이산화탄소"
          className={`w-full resize-none rounded-2xl border-2 px-5 py-4 text-center text-[clamp(1rem,4vw,1.15rem)] font-black outline-none transition placeholder:font-medium disabled:opacity-60 ${game ? "border-white/15 bg-white/10 text-white placeholder:text-white/30 focus:border-info-300 focus:bg-white/15" : "border-line bg-surface-muted text-content placeholder:text-content-subtle focus:border-brand-500 focus:bg-white"}`}
        />
        <p className={`mt-2 text-center text-[11px] font-bold ${game ? "text-brand-100/50" : "text-content-subtle"}`}>여러 단어를 쉼표나 띄어쓰기로 나눠 적어도 됩니다 ({text.trim().length}/{WORD_CLOUD_MAX_LENGTH})</p>
        <SubmitAnswerButton disabled={disabled || !text.trim()} variant={variant} label="제출" />
      </form>
    );
  }

  if (question.type === "LIKERT") {
    const steps = clampLikertSteps(question.likertSteps);
    const selectedStep = Number(text) || 0;
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className={`mb-3 flex items-center justify-between gap-3 text-[11px] font-black ${game ? "text-brand-100/70" : "text-content-muted"}`}>
          <span className="max-w-[45%] text-left">{question.likertMinLabel}</span>
          <span className="max-w-[45%] text-right">{question.likertMaxLabel}</span>
        </div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${steps}, minmax(0, 1fr))` }}>
          {Array.from({ length: steps }, (_, index) => {
            const value = index + 1;
            const active = selectedStep === value;
            return (
              <button
                key={value}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => setText(String(value))}
                className={`min-h-[clamp(3rem,13vw,4rem)] rounded-2xl border-2 text-base font-black shadow-sm transition hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-45 ${
                  active
                    ? game ? "border-info-300 bg-info-300 text-brand-950" : "border-brand-500 bg-brand-500 text-on-brand"
                    : game ? "border-white/15 bg-white/10 text-white hover:border-info-300/50" : "border-line bg-surface-muted text-content hover:border-brand-300"
                }`}
              >
                {value}
              </button>
            );
          })}
        </div>
        <SubmitAnswerButton disabled={disabled || selectedStep < 1} onClick={() => onSubmit({ choiceId: null, textResponse: String(selectedStep) })} variant={variant} label="제출" />
      </div>
    );
  }

  const choose = (choiceId: string) => {
    if (!question.multipleSelection) {
      onSubmit({ choiceId, choiceIds: [choiceId] });
      return;
    }
    setSelected((values) => values.includes(choiceId) ? values.filter((value) => value !== choiceId) : [...values, choiceId]);
  };

  if (question.choices.length === 0) return <div className={`rounded-2xl p-5 text-center text-sm font-bold ${game ? "bg-white/10 text-brand-100/60" : "bg-surface-muted text-content-muted"}`}>이 문항에 등록된 보기가 없습니다.</div>;

  return (
    <div>
      <div className={`grid gap-2.5 ${question.type === "TRUE_FALSE" || game ? "grid-cols-2" : "sm:grid-cols-2"}`}>
        {question.choices.map((choice, index) => {
          const active = selected.includes(choice.id);
          const ChoiceIcon = PLAY_ANSWER_ICONS[index % PLAY_ANSWER_ICONS.length];
          return (
            <button key={choice.id} type="button" disabled={disabled} onClick={() => choose(choice.id)} aria-pressed={question.multipleSelection ? active : undefined} className={`animate-answer-card group relative overflow-hidden rounded-[20px] border-2 border-transparent text-left shadow-lg transition duration-200 hover:-translate-y-1 hover:brightness-110 active:translate-y-0 active:scale-[0.98] disabled:translate-y-0 disabled:opacity-45 ${game ? "min-h-[clamp(3.4rem,15vw,5rem)] p-2.5 sm:min-h-24 sm:p-4" : "min-h-[clamp(3.6rem,16vw,6rem)] p-3 sm:min-h-28 sm:p-5"} ${palette[index % palette.length]} ${active ? `ring-4 ${game ? "ring-white ring-offset-brand-950" : "ring-brand-500 ring-offset-surface"} ring-offset-2` : ""}`} style={{ animationDelay: `${index * 70}ms` }}>
              <span className={`${game ? "mb-1.5 h-7 w-7 rounded-lg sm:mb-2 sm:h-8 sm:w-8" : "mb-2 h-8 w-8 rounded-xl sm:mb-3 sm:h-10 sm:w-10"} grid place-items-center bg-white/90 text-brand-900 shadow-sm`}>{question.type === "TRUE_FALSE" ? <span className="text-base font-black">{index === 0 ? "O" : "X"}</span> : <ChoiceIcon className="h-4.5 w-4.5" strokeWidth={2.4} aria-hidden="true" />}</span>
              <span className={`whitespace-pre-wrap break-words font-black ${game ? "text-[clamp(.8rem,3.4vw,1rem)] sm:text-base" : "text-[clamp(.85rem,3.6vw,1.05rem)] sm:text-lg"}`}>{choice.text}</span>
              {active ? <span className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full bg-white text-brand-700"><CheckIcon className="h-4 w-4" /></span> : null}
            </button>
          );
        })}
      </div>
      {question.type === "SURVEY" ? <p className={`mt-3 text-center text-xs font-bold ${game ? "text-brand-100/60" : "text-content-muted"}`}>정답이 없는 설문입니다. 마음에 드는 보기를 골라 주세요.</p> : null}
      {question.multipleSelection ? <><p className={`mt-3 text-center text-xs font-bold ${game ? "text-brand-100/60" : "text-content-muted"}`}>답을 모두 고른 뒤 제출하세요.</p><SubmitAnswerButton disabled={disabled || selected.length === 0} onClick={() => onSubmit({ choiceId: selected.length === 1 ? selected[0] : null, choiceIds: selected })} variant={variant} /></> : null}
    </div>
  );
}

// 참여형에는 "정답 제출"이 어색해서 라벨을 바꿀 수 있게 두었습니다.
function SubmitAnswerButton({ disabled, onClick, variant = "light", label = "정답 제출" }: { disabled: boolean; onClick?: () => void; variant?: "game" | "light"; label?: string }) {
  return <button type={onClick ? "button" : "submit"} onClick={onClick} disabled={disabled} className={`mt-3 min-h-[clamp(2.9rem,12vw,3.5rem)] w-full rounded-2xl px-5 text-sm font-black shadow-lg transition hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-40 ${variant === "game" ? "bg-info-300 text-brand-950 shadow-info-300/10" : "bg-brand-950 text-on-brand"}`}>{label}</button>;
}

type AsyncQuestion = ({ completed: false } & QuizQuestionPayload) | { completed: true; totalQuestions: number };

function AsyncPlay({ sessionId, quizTitle, publicAccess }: { sessionId: string; quizTitle: string; publicAccess: boolean }) {
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [intro, setIntro] = useState<LiveQuestionIntro | null>(null);
  const [question, setQuestion] = useState<AsyncQuestion | null>(null);
  const [result, setResult] = useState<{ isCorrect: boolean; pointsAwarded: number; completed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const apiBase = publicAccess ? `/api/public/sessions/${sessionId}` : `/api/quiz/sessions/${sessionId}`;

  async function loadCurrentQuestion(signal?: AbortSignal) {
    setError(null);
    try {
      const response = await fetch(`${apiBase}/current-question`, { signal });
      const data = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) { setError(data.error ?? "문항을 불러오지 못했습니다."); return; }
      if (introTimerRef.current) clearTimeout(introTimerRef.current);
      setQuestion(data);
      setResult(null);
      if (!data.completed && hasPointMultiplierIntro(data.points)) {
        const nextIntro: LiveQuestionIntro = {
          questionId: data.questionId,
          questionIndex: data.questionIndex,
          totalQuestions: data.totalQuestions,
          points: data.points,
          multiplier: pointMultiplier(data.points),
          startsAt: new Date(Date.now() + POINT_MULTIPLIER_INTRO_MS).toISOString(),
        };
        setIntro(nextIntro);
        introTimerRef.current = setTimeout(() => {
          setIntro((current) => current?.questionId === nextIntro.questionId ? null : current);
          introTimerRef.current = null;
        }, POINT_MULTIPLIER_INTRO_MS);
      } else {
        setIntro(null);
        introTimerRef.current = null;
      }
    } catch {
      if (!signal?.aborted) setError("문항을 불러오지 못했습니다.");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/start`, { method: "POST", signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (controller.signal.aborted) return;
        if (!response.ok) setError(data.error ?? "과제를 시작하지 못했습니다.");
        else void loadCurrentQuestion(controller.signal);
      })
      .catch(() => { if (!controller.signal.aborted) setError("과제를 시작하지 못했습니다."); });
    return () => controller.abort();
    // 세션 시작 시 한 번만 실행합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  useEffect(() => () => {
    if (introTimerRef.current) clearTimeout(introTimerRef.current);
  }, []);

  async function submit(payload: AnswerPayload) {
    if (!question || question.completed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/answer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.questionId, ...payload }) });
      const data = await response.json();
      if (!response.ok) { setError(data.error ?? "답을 제출하지 못했습니다."); return; }
      if (question.type === "SLIDE") {
        if (data.completed) setQuestion({ completed: true, totalQuestions: question.totalQuestions });
        else void loadCurrentQuestion();
        return;
      }
      setResult({ isCorrect: data.isCorrect, pointsAwarded: data.pointsAwarded, completed: data.completed });
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 제출해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  // 첫 문항조차 없을 때만 치명 오류 화면으로 보냅니다. 제출/다음 문항 네트워크 오류에 기존
  // 문항을 언마운트하면 학생이 같은 답을 다시 시도할 방법이 없어 새로고침해야 했습니다.
  if (error && !question) return <PlayError message={error} />;
  if (!question) return <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10"><LoadingCard label="다음 문항을 준비하는 중..." /></main>;
  if (question.completed) return <CompletionScreen sessionId={sessionId} leaderboard={[]} publicAccess={publicAccess} />;
  if (intro) return <LiveGameSurface contentClassName="px-3 py-2 sm:px-5 sm:py-3 lg:px-6"><PlayerStageHeader title={quizTitle} connected question={intro} /><PointMultiplierIntro intro={intro} /></LiveGameSurface>;

  return (
    // 페이지 스크롤 금지: 화면을 "지금 보이는 높이"(--vvh, 키보드·주소창 반영)에 정확히 가두고,
    // 넘치는 내용은 아래 콘텐츠 영역 안에서만 스크롤합니다. 문제 풀이 중 화면이 밀리지 않습니다.
    <main className="surface-grid flex h-[var(--vvh,100dvh)] max-h-[var(--vvh,100dvh)] flex-col overflow-hidden px-3 py-3 sm:px-5 sm:py-5">
      {error ? <div className="mx-auto mb-3 w-full max-w-3xl rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-bold text-danger-800 lg:max-w-6xl" role="alert">{error}</div> : null}
      {/* 모바일은 세로 스택 그대로, lg부터는 질문·미디어(왼쪽)와 답안(오른쪽) 2컬럼으로 폅니다. */}
      <section className="animate-float-in mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col rounded-[26px] border border-line bg-white p-4 shadow-sm sm:p-6 lg:max-w-6xl lg:p-8">
        <header className="flex items-center justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><StatusBadge status="ASYNC" /><PointMultiplierBadge points={question.points} /><span className="text-xs font-bold text-content-subtle">{question.questionIndex + 1} / {question.totalQuestions}</span></div><h1 className="mt-2 max-w-[60vw] truncate text-sm font-black text-content">{quizTitle}</h1></div><div className="grid h-11 w-11 place-items-center rounded-2xl bg-info-100 text-info-800"><HistoryIcon className="h-5 w-5" /></div></header>
        <div className="mt-3"><ProgressBar value={question.questionIndex + 1} max={question.totalQuestions} /></div>
        {question.type === "SLIDE" ? <><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain"><div className="flex min-h-full flex-col justify-center"><ContentSlide question={question} variant="light" className="mt-5 lg:mt-7" /></div></div><button type="button" onClick={() => void submit({ choiceId: null })} disabled={submitting} className="mx-auto mt-4 min-h-13 w-full max-w-xl shrink-0 rounded-2xl bg-brand-950 px-6 text-sm font-black text-on-brand disabled:opacity-50">{submitting ? "다음으로 이동 중..." : "다음"}</button></> : (
          <AsyncQuestionContent question={question} disabled={submitting} onSubmit={(payload) => void submit(payload)} answerSlot={result ? (() => { const participation = isParticipationType(question.type); return <div className={`mx-auto w-full max-w-xl rounded-[26px] p-6 text-center ${participation ? "bg-info-100 text-info-950" : result.isCorrect ? "bg-brand-100 text-brand-950" : result.pointsAwarded > 0 ? "bg-warning-100 text-warning-950" : "bg-danger-100 text-danger-950"}`}><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-white">{participation || result.isCorrect ? <CheckIcon className={`h-6 w-6 ${participation ? "text-info-700" : "text-brand-700"}`} /> : <XIcon className="h-6 w-6 text-danger-700" />}</div><h3 className="mt-4 text-2xl font-black">{participation ? "참여했어요!" : result.isCorrect ? "정답이에요!" : result.pointsAwarded > 0 ? "정답에 가까워요!" : "아쉽지만 오답이에요"}</h3>{participation ? <p className="mt-2 text-sm font-bold opacity-70">점수가 없는 문항이에요</p> : <p className="mt-2 text-sm font-bold opacity-70">+{result.pointsAwarded.toLocaleString("ko-KR")}점</p>}{result.completed ? <Link href={publicAccess ? `/p/${sessionId}/report` : `/quiz/activities/${sessionId}/report`} className="mt-5 inline-flex rounded-xl bg-brand-950 px-5 py-3 text-sm font-black text-on-brand">최종 결과 보기</Link> : <button type="button" onClick={() => void loadCurrentQuestion()} className="mt-5 rounded-xl bg-brand-950 px-6 py-3 text-sm font-black text-on-brand">다음 문항</button>}</div>; })() : undefined} />
        )}
      </section>
    </main>
  );
}

// 자율 풀이 문항 본문. 실제 플레이와 편집기 미리보기가 이 컴포넌트 하나를 공유해서,
// 화면이 바뀌어도 미리보기가 항상 같은 모습을 유지합니다.
export function AsyncQuestionContent({ question, disabled, onSubmit, answerSlot }: { question: QuizQuestionPayload; disabled: boolean; onSubmit: (payload: AnswerPayload) => void; answerSlot?: React.ReactNode }) {
  // 핀 유형은 답안 영역이 곧 이미지라, 왼쪽 미디어를 함께 그리면 같은 이미지가 두 번 나옵니다.
  // 결과 카드(answerSlot)를 보여 줄 때는 이미지가 없어 원래의 2단 배치를 그대로 씁니다.
  const pin = isPinType(question.type) && !answerSlot;
  return (
    // 바깥이 스크롤 컨테이너, 안쪽(min-h-full + justify-center)이 세로 센터링을 맡습니다.
    // 스크롤 컨테이너에 직접 justify-center를 걸면 내용이 넘칠 때 위쪽이 잘립니다.
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className={`flex min-h-full flex-col justify-center ${pin ? "" : "lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(400px,0.95fr)] lg:items-center lg:gap-10"}`}>
        <div>
          <h2 className={`mx-auto my-4 max-w-2xl whitespace-pre-wrap text-center text-[clamp(1.1rem,4.6vw,1.5rem)] font-black leading-tight tracking-[-0.04em] text-content sm:my-7 sm:text-4xl ${pin ? "" : "lg:mx-0 lg:my-0 lg:max-w-none lg:text-left lg:text-[2.6rem] lg:leading-[1.12]"}`}>{question.text}</h2>
          {pin ? null : <QuestionMedia question={question} variant="light" className="mx-auto mb-4 w-full max-w-xl lg:mx-0 lg:mb-0 lg:mt-7 lg:max-w-md" />}
        </div>
        <div className={pin ? "mx-auto w-full max-w-2xl" : "lg:rounded-[26px] lg:border lg:border-line lg:bg-surface-muted/60 lg:p-6"}>
          {answerSlot ?? <AnswerInput key={question.questionId} question={question} disabled={disabled} onSubmit={onSubmit} />}
        </div>
      </div>
    </div>
  );
}

function CompletionScreen({ sessionId, leaderboard, publicAccess }: { sessionId: string; leaderboard: Leaderboard; publicAccess: boolean }) {
  return (
    <LiveGameSurface className="items-center justify-center">
      <div className="my-auto w-full py-8">
        {leaderboard.length > 0 ? <FinalPodium entries={leaderboard} /> : <div className="text-center"><p className="text-xs font-black uppercase tracking-[0.24em] text-info-200">Quiz complete</p><h1 className="mt-3 text-4xl font-black sm:text-5xl">끝까지 완료했어요!</h1><p className="mt-3 text-sm font-bold text-brand-100/60">수고했어요. 문항별 결과에서 틀린 문제를 복습해 보세요.</p></div>}
        <div className="mt-9 text-center"><Link href={publicAccess ? `/p/${sessionId}/report` : `/quiz/activities/${sessionId}/report`} className="inline-flex min-h-13 items-center rounded-2xl bg-info-300 px-7 text-sm font-black text-brand-950 shadow-xl shadow-info-300/15">내 결과 보기</Link></div>
      </div>
    </LiveGameSurface>
  );
}

function PlayError({ message }: { message: string }) {
  return <main className="grid flex-1 place-items-center px-4 py-12"><section className="w-full max-w-lg rounded-[28px] border border-danger-100 bg-white p-8 text-center shadow-xl shadow-content/5"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-danger-100 text-danger-700"><XIcon className="h-5 w-5" /></div><h1 className="mt-5 text-xl font-black text-content">퀴즈를 계속할 수 없어요</h1><p className="mt-3 text-sm leading-6 text-content-muted">{message}</p><Link href="/j" className="mt-6 inline-flex rounded-xl bg-brand-950 px-5 py-3 text-sm font-black text-on-brand">참여 화면으로</Link></section></main>;
}
