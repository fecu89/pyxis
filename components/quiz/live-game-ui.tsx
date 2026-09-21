"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Bolt, Radio, Sparkles } from "lucide-react";
import { CountUpNumber, type Leaderboard } from "@/components/quiz/live-leaderboard";
import { CheckIcon, TrophyIcon, XIcon } from "@/components/ui/icons";
import { formatPointMultiplier, hasPointMultiplierIntro, type PointMultiplierIntroPayload } from "@/lib/quiz/point-multiplier";
import type { ParticipationSummary } from "@/lib/quiz/participation-summary";
import type { PinArea, PinPoint } from "@/lib/quiz/image-pin";
import { countdownStepAt, sequenceStageAt, type QuestionSequencePayload } from "@/lib/quiz/question-sequence";

export type LiveQuestionType = "SINGLE_CHOICE" | "TRUE_FALSE" | "ORDERING" | "SHORT_ANSWER" | "NUMERIC" | "PIN_ANCHOR" | "SURVEY" | "WORD_CLOUD" | "DROP_PIN" | "LIKERT" | "SLIDE";
export type SlideLayout = "CLASSIC" | "BIG_TITLE" | "TITLE_TEXT" | "BULLETS" | "QUOTE" | "BIG_MEDIA";
export type AnswerPalette = "BRAND" | "SOFT" | "FOREST";

export type QuizQuestionPayload = {
  questionId: string;
  type: LiveQuestionType;
  questionIndex: number;
  totalQuestions: number;
  text: string;
  imageUrl?: string | null;
  imageAlt?: string | null;
  imagePlaceholder?: string | null;
  choices: { id: string; text: string }[];
  orderedItems: string[];
  numericMin: number | null;
  numericMax: number | null;
  numericStep: number | null;
  multipleSelection: boolean;
  answerPalette: AnswerPalette;
  timeLimitSec: number;
  points: number;
  slideLayout: SlideLayout | null;
  slideBody: string | null;
  // LIKERT 전용. 정답이 없는 유형이라 학생 화면에 그대로 내려보냅니다.
  likertSteps?: number | null;
  likertMinLabel?: string | null;
  likertMaxLabel?: string | null;
};

export type LiveQuestionPayload = QuizQuestionPayload & { startedAt: string };
export type LiveQuestionIntro = PointMultiplierIntroPayload;
export type ChoiceReveal = { questionId: string; type: "SINGLE_CHOICE" | "TRUE_FALSE"; correctChoiceId: string | null; correctChoiceIds: string[]; choiceBreakdown: { choiceId: string; count: number }[] };
/** 참여형은 "정답"이 아니라 모인 응답 자체가 공개 내용이라 집계를 통째로 실어 보냅니다. */
export type ParticipationReveal = { questionId: string; type: "SURVEY" | "WORD_CLOUD" | "DROP_PIN" | "LIKERT"; summary: ParticipationSummary | null };
export type PinDropReveal = { questionId: string; type: "PIN_ANCHOR"; pinAreas: PinArea[]; pins: { point: PinPoint; isCorrect: boolean }[]; correctCount: number; totalAnswered: number };
export type LiveQuestionReveal = ChoiceReveal | ParticipationReveal | PinDropReveal | { questionId: string; type: "SHORT_ANSWER"; acceptedAnswers: string[]; correctCount: number; totalAnswered: number } | { questionId: string; type: "ORDERING"; correctOrder: string[]; correctCount: number; totalAnswered: number } | { questionId: string; type: "NUMERIC"; numericAnswer: number | null; correctCount: number; totalAnswered: number } | { questionId: string; type: "SLIDE" };

const QUESTION_LABELS: Record<LiveQuestionType, string> = {
  SINGLE_CHOICE: "객관식",
  TRUE_FALSE: "OX 퀴즈",
  ORDERING: "순서 맞추기",
  SHORT_ANSWER: "단답형",
  NUMERIC: "숫자 추측",
  PIN_ANCHOR: "핀 고정형",
  SURVEY: "설문",
  WORD_CLOUD: "워드 클라우드",
  DROP_PIN: "드롭 핀",
  LIKERT: "리커트 척도",
  SLIDE: "미디어 슬라이드",
};

// 정답 공개 폭죽. 여섯 색이 서로 달라야 "터진다"는 느낌이 살아서 범주 색으로 둡니다.
// 초록이던 두 알만 무대의 포인트 색(사이언 계열)으로 옮겼습니다.
const PARTICLES = [
  ["8%", "18%", "-34px", "-56px", "#70e8ee", "0ms"],
  ["18%", "72%", "-55px", "28px", "#38bdf8", "90ms"],
  ["31%", "12%", "-18px", "-72px", "#facc15", "40ms"],
  ["42%", "78%", "-10px", "62px", "#fb7185", "120ms"],
  ["58%", "14%", "22px", "-68px", "#1bd3db", "70ms"],
  ["68%", "82%", "38px", "58px", "#fbbf24", "20ms"],
  ["82%", "24%", "58px", "-42px", "#a78bfa", "110ms"],
  ["92%", "68%", "62px", "34px", "#22d3ee", "55ms"],
] as const;

const MULTIPLIER_RAYS = Array.from({ length: 12 }, (_, index) => index * 30);
const MULTIPLIER_SPARKS = [
  ["9%", "18%", "0ms"], ["18%", "70%", "180ms"], ["29%", "30%", "80ms"],
  ["38%", "82%", "260ms"], ["48%", "14%", "120ms"], ["57%", "72%", "40ms"],
  ["68%", "24%", "220ms"], ["76%", "84%", "100ms"], ["88%", "34%", "300ms"],
  ["94%", "68%", "160ms"],
] as const;

export function useLiveCountdown(startedAt: string, seconds: number) {
  const calculate = () => Math.max(0, seconds - (Date.now() - new Date(startedAt).getTime()) / 1000);
  // Date.now()를 state initializer에서 부르면 SSR 시각과 hydration 시각이 달라집니다. 첫 프레임은
  // 서버·클라이언트가 같은 제한 시간으로 그리고, 마운트 뒤 실제 서버 기준 시각에 맞춥니다.
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => setRemaining(calculate()), 0);
    const timer = window.setInterval(() => setRemaining(calculate()), 100);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
    // calculate는 startedAt/seconds로만 결정되며 타이머를 다시 만들 필요가 없습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, startedAt]);

  return remaining;
}

// fit: 화면을 페이지 스크롤 없이 "지금 보이는 높이"에 정확히 가둡니다. dvh는 가상 키보드를
// 반영하지 못하는 브라우저가 있어 visualViewport 기반 --vvh(components/visual-viewport-unit.tsx)를
// 우선 씁니다. LIVE 진행 화면은 모든 요소를 이 높이 안에서 축소하므로 페이지 스크롤을 만들지 않습니다.
export function LiveGameSurface({ children, className = "", contentClassName, fit = false }: { children: ReactNode; className?: string; contentClassName?: string; fit?: boolean }) {
  return (
    <main className={`live-game-surface relative isolate flex flex-1 overflow-hidden bg-brand-950 text-on-brand ${fit ? "h-[var(--vvh,100dvh)] max-h-[var(--vvh,100dvh)]" : ""} ${className}`}>
      <div className="live-game-orb live-game-orb-left" aria-hidden="true" />
      <div className="live-game-orb live-game-orb-right" aria-hidden="true" />
      <div className="live-game-grid absolute inset-0 -z-10" aria-hidden="true" />
      <div className={`relative z-10 mx-auto flex w-full max-w-[1380px] flex-1 flex-col ${fit ? "min-h-0 overflow-hidden" : ""} ${contentClassName ?? "px-4 py-5 sm:px-6 sm:py-7 lg:px-9"}`}>{children}</div>
    </main>
  );
}

export function LiveStageHeader({ title, connected, phaseLabel, question, trailing }: { title: string; connected?: boolean; phaseLabel: string; question?: Pick<QuizQuestionPayload, "questionIndex" | "totalQuestions"> | null; trailing?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/[0.07] px-4 py-3 backdrop-blur-md sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-info-300 font-black text-brand-950 shadow-lg shadow-info-300/15">Q</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio className={`h-3.5 w-3.5 ${connected === false ? "text-warning-300" : "text-info-300"}`} aria-hidden="true" />
            <p className="truncate text-sm font-black sm:text-base">{title}</p>
          </div>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-100/50">{phaseLabel}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {question ? <p className="hidden text-xs font-bold text-brand-100/60 sm:block">문제 {question.questionIndex + 1} / {question.totalQuestions}</p> : null}
        {trailing}
      </div>
    </header>
  );
}

export function QuestionTypeBadge({ type }: { type: LiveQuestionType }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-info-300/25 bg-info-300/10 px-3 py-1.5 text-[11px] font-black text-info-200"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{QUESTION_LABELS[type]}</span>;
}

export function PointMultiplierBadge({ points }: { points: number }) {
  if (!hasPointMultiplierIntro(points)) return null;
  const multiplier = formatPointMultiplier(points);
  const triple = Number(multiplier) >= 3;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-black shadow-lg ${triple ? "border-accent-soft-fg/50 bg-gradient-to-r from-accent-soft-fg to-warning-300 text-on-brand shadow-accent-soft-fg/20" : "border-warning-200/50 bg-warning-300 text-warning-950 shadow-warning-300/15"}`}><Bolt className="h-3.5 w-3.5 fill-current" aria-hidden="true" />{multiplier}배 점수</span>;
}

export function PointMultiplierIntro({ intro }: { intro: PointMultiplierIntroPayload }) {
  const progressRef = useRef<HTMLSpanElement>(null);
  const multiplier = formatPointMultiplier(intro.points);
  const triple = intro.multiplier >= 3;

  useEffect(() => {
    if (!progressRef.current) return;
    const remainingMs = Math.max(100, new Date(intro.startsAt).getTime() - Date.now());
    progressRef.current.style.animationDuration = `${remainingMs}ms`;
  }, [intro.startsAt]);

  return (
    <section key={intro.questionId} className="point-multiplier-intro relative grid min-h-[58dvh] flex-1 place-items-center overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.06] px-5 py-10 text-center shadow-2xl" data-tier={triple ? "triple" : "double"} aria-live="assertive" aria-label={`${multiplier}배 점수 문제`}>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="point-multiplier-halo absolute left-1/2 top-1/2 h-[min(76vw,720px)] w-[min(76vw,720px)] -translate-x-1/2 -translate-y-1/2 rounded-full" />
        {MULTIPLIER_RAYS.map((angle) => <span key={angle} className="point-multiplier-ray absolute left-1/2 top-1/2 h-1.5 w-[54vmax] origin-left rounded-full" style={{ "--multiplier-ray-angle": `${angle}deg` } as CSSProperties} />)}
        {MULTIPLIER_SPARKS.map(([left, top, delay], index) => <span key={`${left}-${top}`} className="point-multiplier-spark absolute h-2.5 w-2.5 rounded-full" style={{ left, top, animationDelay: delay, "--multiplier-spark-color": index % 3 === 0 ? "#70e8ee" : index % 3 === 1 ? "#fbbf24" : "#38bdf8" } as CSSProperties} />)}
      </div>
      <div className="relative z-10 mx-auto max-w-3xl">
        <p className="point-multiplier-copy text-xs font-black uppercase tracking-[0.34em] text-info-200">{triple ? "초고득점 찬스" : "보너스 찬스"}</p>
        <p className="point-multiplier-number mt-5 bg-gradient-to-br from-info-200 via-warning-300 to-danger-400 bg-clip-text font-mono text-[clamp(6.5rem,24vw,15rem)] font-black leading-[0.76] tracking-[-0.1em] text-transparent drop-shadow-2xl">×{multiplier}</p>
        <h1 className="point-multiplier-copy mt-8 text-[clamp(2rem,6vw,4.5rem)] font-black leading-none tracking-[-0.055em]">{multiplier}배 점수 문제!</h1>
        <p className="point-multiplier-copy mx-auto mt-5 max-w-xl text-sm font-bold leading-6 text-brand-100/65 sm:text-base">이번 문제는 최대 <strong className="text-warning-200">{intro.points.toLocaleString("ko-KR")}점</strong>입니다. 순위를 뒤집을 기회를 놓치지 마세요.</p>
        <div className="mx-auto mt-8 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10" aria-hidden="true"><span ref={progressRef} className="point-multiplier-progress block h-full rounded-full bg-gradient-to-r from-info-300 via-warning-300 to-danger-400" /></div>
      </div>
    </section>
  );
}

// ─── 문항 제시 시퀀스: [배수 인트로] → 3·2·1 카운트다운 → 문항 읽기(보기 숨김) → 답안 공개 ───
// 서버가 내려준 절대시각(countdownStartsAt/readingStartsAt/startsAt)을 시계와 비교해 단계를
// 정하므로, 중간 입장·재접속도 애니메이션 음수 지연(negative delay)으로 같은 장면에 맞춰집니다.
// 미디어 슬라이드는 이 시퀀스를 타지 않습니다.
export function QuestionSequenceStage({ sequence, isHost = false, skipPending = false, onSkip }: { sequence: QuestionSequencePayload; isHost?: boolean; skipPending?: boolean; onSkip?: () => void }) {
  const readingStart = new Date(sequence.readingStartsAt).getTime();
  const answerStart = new Date(sequence.startsAt).getTime();
  // 이 컴포넌트는 소켓의 question:sequence 또는 session:join 응답을 받은 뒤 클라이언트에서
  // 마운트됩니다. 첫 프레임부터 실제 시각을 사용해야 재접속 중 이미 지난 배수 인트로나 3을
  // 잠깐 다시 보여주지 않습니다.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  const skipButton = isHost && onSkip ? (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-20 flex justify-center">
      <button type="button" onClick={onSkip} disabled={skipPending} className="pointer-events-auto min-h-11 rounded-2xl border border-white/15 bg-white/10 px-6 text-sm font-black text-white backdrop-blur transition hover:bg-white/15 disabled:opacity-40">{skipPending ? "공개 중..." : "바로 보기 공개"}</button>
    </div>
  ) : null;

  const stage = sequenceStageAt(sequence, now);

  if (stage === "MULTIPLIER_INTRO") {
    return (
      <section className="relative flex min-h-0 flex-1 flex-col">
        <PointMultiplierIntro intro={{ questionId: sequence.questionId, questionIndex: sequence.questionIndex, totalQuestions: sequence.totalQuestions, points: sequence.points, multiplier: sequence.multiplier, startsAt: sequence.countdownStartsAt }} />
        {skipButton}
      </section>
    );
  }

  if (stage === "COUNTDOWN") {
    // 남은 시간으로 현재 숫자(3→2→1)를 계산. 숫자가 바뀔 때마다 keyframe 이름을 번갈아 써서
    // (같은 이름 재사용 시 애니메이션이 다시 재생되지 않는 문제) 팝 애니메이션을 강제로 재생합니다.
    const step = countdownStepAt(readingStart, now);
    return (
      <section className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.06] shadow-2xl" aria-live="assertive" aria-label={`${step}초 뒤 문제가 시작됩니다`}>
        <div className="text-center">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-info-200">문제 {sequence.questionIndex + 1} · 준비하세요</p>
          <div key={step} className="relative mx-auto mt-8 grid h-44 w-44 place-items-center sm:h-56 sm:w-56">
            <span className={`absolute inset-0 rounded-full border-4 border-info-300/60 ${step % 2 === 0 ? "sequence-ring-a" : "sequence-ring-b"}`} aria-hidden="true" />
            <span className={`font-mono text-[7rem] font-black leading-none text-info-300 drop-shadow-[0_0_34px_rgba(112,232,238,.45)] sm:text-[9rem] ${step % 2 === 0 ? "sequence-count-a" : "sequence-count-b"}`}>{step}</span>
          </div>
          <div className="mt-6 flex items-center justify-center gap-2" aria-hidden="true">
            <span className="sequence-status-dot" />
            <span className="sequence-status-dot [animation-delay:160ms]" />
            <span className="sequence-status-dot [animation-delay:320ms]" />
          </div>
        </div>
        {skipButton}
      </section>
    );
  }

  const readingMs = answerStart - readingStart;
  const elapsedMs = now - readingStart;
  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.06] shadow-2xl" aria-live="polite">
      {/* 남은 읽기 시간: 폭 100%→0 리니어. 늦게 합류하면 음수 지연으로 중간부터 이어집니다. */}
      <div className="h-1.5 shrink-0 overflow-hidden rounded-t-[34px] bg-white/10" aria-hidden="true">
        <div key={sequence.questionId} className="sequence-reading-bar h-full bg-info-300" style={{ animationDuration: `${readingMs}ms`, animationDelay: `${-Math.max(0, elapsedMs)}ms` }} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-5 py-6 text-center sm:px-10">
        <p className="text-[11px] font-black uppercase tracking-[0.26em] text-brand-100/50">문제 {sequence.questionIndex + 1}</p>
        <h1 className="sequence-reading-text max-w-4xl whitespace-pre-wrap text-[clamp(1.5rem,5.6vw,3.4rem)] font-black leading-[1.18] tracking-[-0.045em] [word-break:keep-all]">{sequence.text}</h1>
        {sequence.imageUrl || sequence.imagePlaceholder ? (
          // 이미지가 커도 진행 바·하단 요소가 잘리지 않도록 뷰포트 기준으로 높이를 제한합니다.
          <figure className="relative w-full max-w-xl overflow-hidden rounded-[24px] border border-white/15 bg-white/[0.07]" style={{ height: "min(260px, 26vh)" }}>
            {sequence.imageUrl ? <Image src={sequence.imageUrl} alt={sequence.imageAlt || "문제 이미지"} fill unoptimized sizes="(max-width: 768px) 100vw, 576px" className="object-contain p-3" /> : <div className="live-game-grid grid h-full place-items-center"><span className="rounded-full border border-white/15 bg-brand-950/70 px-4 py-2 text-xs font-black text-brand-100">{sequence.imagePlaceholder}</span></div>}
          </figure>
        ) : null}
        <p className="text-xs font-bold text-brand-100/45">곧 보기가 열립니다 — 문제를 읽어 두세요</p>
      </div>
      {skipButton}
    </section>
  );
}

export function CountdownRing({ startedAt, seconds, size = "large" }: { startedAt: string; seconds: number; size?: "small" | "large" }) {
  const remaining = useLiveCountdown(startedAt, seconds);
  const ratio = Math.max(0, Math.min(1, remaining / seconds));
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const urgent = remaining <= 5;
  const dimension = size === "large" ? "h-32 w-32 sm:h-36 sm:w-36" : "h-14 w-14";

  return (
    <div className={`relative shrink-0 ${dimension}`} role="timer" aria-label={`${Math.ceil(remaining)}초 남음`}>
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.12)" strokeWidth="10" />
        <circle cx="60" cy="60" r={radius} fill="none" stroke={urgent ? "var(--danger-400)" : "var(--info-300)"} strokeWidth="10" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} className="transition-[stroke-dashoffset] duration-100" />
      </svg>
      <div className={`absolute inset-0 grid place-items-center font-mono font-black ${size === "large" ? "text-4xl" : "text-base"} ${urgent ? "text-danger-300" : "text-white"}`}>{Math.ceil(remaining)}</div>
      {urgent ? <span className="absolute inset-2 -z-10 animate-ping rounded-full border border-danger-400/40" aria-hidden="true" /> : null}
    </div>
  );
}

export function SpeedScoreHint() {
  return <p className="inline-flex items-center gap-2 text-xs font-black text-info-200"><Bolt className="h-4 w-4 fill-current" aria-hidden="true" />빠를수록 더 높은 점수를 받아요</p>;
}

// fillHeight: 부모(슬라이드 레이아웃)가 정한 높이를 그대로 채웁니다. 이 경우 aspect-[4/3]를
// 걸면 안 됩니다 — 높이가 확정된 상태에서 aspect-ratio가 "너비"를 비율로 계산해 버려, 넓은
// 컨테이너 왼쪽에 좁은 박스로 몰리는 버그가 있었습니다. 파일명이 흘러들던 캡션(figcaption)은
// 정보가 아니라서 제거했고, 대체 텍스트(alt)로만 남깁니다.
export function QuestionMedia({ question, className = "", variant = "game", fillHeight = false }: { question: Pick<QuizQuestionPayload, "imageUrl" | "imageAlt" | "imagePlaceholder">; className?: string; variant?: "game" | "light"; fillHeight?: boolean }) {
  if (!question.imageUrl && !question.imagePlaceholder) return null;
  const light = variant === "light";
  return (
    <figure className={`relative overflow-hidden rounded-[24px] border ${light ? "border-line bg-surface-muted" : "border-white/15 bg-white/[0.07]"} ${className}`}>
      {/* 기본 모드는 한 화면 맞춤을 위해 보이는 높이의 30%로 상한을 겁니다. */}
      <div className={fillHeight ? "relative h-full min-h-44 w-full" : "relative aspect-[4/3] max-h-[calc(var(--vvh,100dvh)*0.3)] min-h-32 w-full sm:min-h-44"}>
        {question.imageUrl ? <Image src={question.imageUrl} alt={question.imageAlt || "문제 이미지"} fill unoptimized sizes="(max-width: 768px) 100vw, 720px" className="object-contain p-2" /> : <div className={`${light ? "soft-dots bg-brand-50" : "live-game-grid"} grid h-full place-items-center`}><span className={`rounded-full border px-4 py-2 text-xs font-black ${light ? "border-brand-100 bg-white text-brand-800 shadow-sm" : "border-white/15 bg-brand-950/70 text-brand-100"}`}>{question.imagePlaceholder}</span></div>}
      </div>
    </figure>
  );
}

export function ContentSlide({ question, variant = "game", className = "" }: { question: Pick<QuizQuestionPayload, "text" | "slideBody" | "slideLayout" | "imageUrl" | "imageAlt" | "imagePlaceholder">; variant?: "game" | "light"; className?: string }) {
  const light = variant === "light";
  const layout = question.slideLayout ?? "CLASSIC";
  const title = <h1 className={`whitespace-pre-wrap font-black leading-tight tracking-[-0.05em] ${layout === "BIG_TITLE" ? "text-left text-[clamp(2.5rem,7vw,5.5rem)]" : layout === "QUOTE" ? `mt-5 text-center text-sm ${light ? "text-brand-700" : "text-info-200"}` : "text-center text-[clamp(2rem,5vw,4.2rem)]"}`}>{question.text}</h1>;
  const lines = (question.slideBody ?? "").split("\n").filter(Boolean);
  const body = layout === "BULLETS" ? <ul className={`space-y-3 text-lg font-bold ${light ? "text-content" : "text-brand-50"}`}>{lines.map((line, index) => <li key={`${line}-${index}`} className="flex gap-3"><span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${light ? "bg-brand-600" : "bg-info-300"}`} />{line}</li>)}</ul> : <p className={`whitespace-pre-wrap ${layout === "QUOTE" ? `text-center text-[clamp(1.8rem,5vw,3.8rem)] font-black leading-snug ${light ? "text-brand-950" : "text-white"}` : `text-base font-bold leading-7 sm:text-lg sm:leading-8 ${light ? "text-content-muted" : "text-brand-100/75"}`}`}>{question.slideBody}</p>;
  const media = question.imageUrl || question.imagePlaceholder ? <QuestionMedia question={question} variant={variant} fillHeight className="h-full w-full" /> : null;
  const surface = light ? "border-line bg-white text-content shadow-sm" : "border-white/10 bg-white/[0.07] text-white shadow-2xl";
  if (layout === "BIG_MEDIA") return <div className={`flex min-h-[54dvh] flex-col rounded-[30px] border p-5 ${surface} ${className}`}>{media && <div className="min-h-64 flex-1">{media}</div>}<div className="mt-5">{title}</div>{question.slideBody && <div className="mt-3 text-center">{body}</div>}</div>;
  if (layout === "BIG_TITLE") return <div className={`grid min-h-[54dvh] items-center gap-7 rounded-[30px] border p-7 lg:grid-cols-2 ${surface} ${className}`}><div>{title}<div className="mt-6">{body}</div></div>{media}</div>;
  if (layout === "TITLE_TEXT" || layout === "BULLETS") return <div className={`min-h-[54dvh] rounded-[30px] border p-7 ${surface} ${className}`}>{title}<div className="mt-8 grid items-center gap-7 lg:grid-cols-2"><div>{body}</div>{media}</div></div>;
  if (layout === "QUOTE") return <div className={`relative flex min-h-[54dvh] items-center justify-center overflow-hidden rounded-[30px] border p-9 ${light ? "border-brand-200 bg-brand-50" : "border-info-300/15 bg-gradient-to-br from-brand-900 to-info-800"} ${className}`}><span className="absolute left-7 top-0 font-serif text-[11rem] leading-none text-info-300/20">“</span><div className="relative z-10 max-w-4xl">{body}{title}</div></div>;
  return <div className={`flex min-h-[54dvh] flex-col items-center justify-center gap-6 rounded-[30px] border p-8 ${surface} ${className}`}>{title}<div className="max-w-3xl text-center">{body}</div>{media && <div className="w-full max-w-3xl">{media}</div>}</div>;
}

export function AnswerRevealEffects({ tone = "celebrate" }: { tone?: "celebrate" | "miss" | "neutral" }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-[inherit]" aria-hidden="true">
      <div className={tone === "miss" ? "animate-answer-flash-miss absolute inset-0 bg-danger-400/40" : "animate-answer-flash absolute inset-0 bg-white/40"} />
      {tone !== "miss" ? PARTICLES.map(([left, top, x, y, color, delay], index) => <span key={index} className="animate-answer-particle absolute h-3 w-3 rounded-sm" style={{ left, top, backgroundColor: color, animationDelay: delay, "--particle-x": x, "--particle-y": y, "--particle-rotation": `${index % 2 ? 210 : -180}deg` } as CSSProperties} />) : <><span className="animate-miss-ring absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-danger-300/60" /><span className="animate-miss-ring absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-danger-300/30 [animation-delay:120ms]" /></>}
    </div>
  );
}

export function SubmissionWaiting({ answeredCount, totalCount }: { answeredCount?: number; totalCount?: number }) {
  return (
    <div className="animate-game-pop grid min-h-64 place-items-center rounded-[28px] border border-white/10 bg-white/[0.07] p-8 text-center">
      <div>
        <div className="relative mx-auto grid h-20 w-20 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full border border-info-300/40" aria-hidden="true" />
          <span className="grid h-16 w-16 place-items-center rounded-full bg-info-300 text-brand-950 shadow-xl shadow-info-300/20"><CheckIcon className="h-7 w-7" /></span>
        </div>
        <h2 className="mt-6 text-2xl font-black sm:text-3xl">답안 잠금 완료!</h2>
        <p className="mt-2 text-sm font-bold text-brand-100/60">정답 공개까지 잠시만 기다려 주세요.</p>
        {answeredCount !== undefined && totalCount !== undefined ? <p className="mt-5 font-mono text-xs font-black text-info-200">{answeredCount} / {totalCount}명 제출</p> : null}
        <div className="mx-auto mt-5 flex w-fit gap-2" aria-hidden="true"><span className="game-wait-dot" /><span className="game-wait-dot [animation-delay:160ms]" /><span className="game-wait-dot [animation-delay:320ms]" /></div>
      </div>
    </div>
  );
}

export function PersonalResultCard({ result, submitted }: { result: { isCorrect: boolean; pointsAwarded: number } | null; submitted: boolean }) {
  if (!result) return <div className="animate-game-pop rounded-[24px] border border-white/10 bg-white/[0.07] p-6 text-center text-sm font-bold text-brand-100/60">{submitted ? "개인 점수를 계산하고 있어요..." : "이번 문제에는 답안을 제출하지 않았어요."}</div>;
  const partial = !result.isCorrect && result.pointsAwarded > 0;
  return (
    <section className={`animate-result-bounce relative overflow-hidden rounded-[30px] border p-6 text-center ${result.isCorrect ? "border-info-300/40 bg-info-300 text-brand-950" : partial ? "border-warning-300/40 bg-warning-300 text-warning-950" : "border-danger-300/30 bg-danger-400 text-white"}`} aria-live="polite">
      <AnswerRevealEffects tone={result.isCorrect || partial ? "celebrate" : "miss"} />
      <div className="relative z-30">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/90 shadow-lg">{result.isCorrect || partial ? <CheckIcon className="h-8 w-8 text-brand-700" /> : <XIcon className="h-8 w-8 text-danger-600" />}</span>
        <p className="mt-4 text-3xl font-black sm:text-4xl">{result.isCorrect ? "정답이에요!" : partial ? "아주 가까워요!" : "아쉽지만 오답"}</p>
        <p className="mt-2 text-sm font-bold opacity-65">이번 문항 획득 점수</p>
        <p className="mt-2 font-mono text-4xl font-black sm:text-5xl">+<CountUpNumber key={result.pointsAwarded} from={0} to={result.pointsAwarded} duration={1000} /></p>
      </div>
    </section>
  );
}

export function FinalPodium({ entries, title = "최종 TOP 3" }: { entries: Leaderboard; title?: string }) {
  const top = entries.slice(0, 3);
  if (top.length === 0) return null;
  // 시상대는 1위만 브랜드(사이언→파랑)로 올리고 2·3위는 은·동으로 남깁니다. 셋을 같은 색상각의
  // 명도 단계로 바꾸면 "파란 계단 세 개"가 되어 등수가 색으로 읽히지 않습니다. 은은 중립 회색이라
  // 테마와 무관한 고정값(slate)을 그대로 두는 게 맞고, 동은 --warning-* 스케일보다 한 뼘 더 붉어야
  // 금과 구분돼서 orange를 남깁니다.
  const styles = {
    1: { order: "sm:order-2", height: "h-44 sm:h-56", tone: "from-info-300 to-brand-300 text-brand-950", delay: "[animation-delay:900ms]", medal: "1" },
    2: { order: "sm:order-1", height: "h-36 sm:h-44", tone: "from-slate-200 to-white text-slate-900", delay: "[animation-delay:300ms]", medal: "2" },
    3: { order: "sm:order-3", height: "h-28 sm:h-36", tone: "from-warning-200 to-orange-200 text-warning-950", delay: "[animation-delay:600ms]", medal: "3" },
  } as const;

  return (
    <section className="w-full" aria-label={title}>
      <div className="mb-7 text-center"><TrophyIcon className="mx-auto h-9 w-9 text-info-300" /><p className="mt-3 text-xs font-black uppercase tracking-[0.24em] text-info-200">Hall of fame</p><h2 className="mt-2 text-3xl font-black sm:text-4xl">{title}</h2></div>
      <ol className="mx-auto grid max-w-4xl items-end gap-3 sm:grid-cols-3 sm:gap-5">
        {top.map((entry) => { const style = styles[entry.rank as 1 | 2 | 3] ?? styles[3]; return <li key={entry.participantId} className={`animate-podium-rise flex flex-col justify-end ${style.order} ${style.delay}`}><div className="mb-3 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full border-4 border-white/20 bg-white/10 text-xl font-black">{entry.nickname.slice(0, 1)}</span><p className="mt-2 truncate text-lg font-black">{entry.nickname}</p><p className="font-mono text-sm font-black text-info-200"><CountUpNumber from={entry.previousScore} to={entry.score} />점</p></div><div className={`grid ${style.height} place-items-center rounded-t-[28px] bg-gradient-to-b ${style.tone} shadow-2xl`}><span className="text-5xl font-black">{style.medal}</span></div></li>; })}
      </ol>
    </section>
  );
}
