"use client";

import { useMemo, useState } from "react";
import { ContentSlide, type LiveQuestionPayload } from "@/components/quiz/live-game-ui";
import { AsyncQuestionContent, PlayerQuestionStage } from "@/components/quiz/play-session";
import { XIcon } from "@/components/ui/icons";
import { autoNumericGrid } from "@/lib/quiz/numeric";

type PreviewQuestion = {
  clientId: string;
  type: LiveQuestionPayload["type"];
  text: string;
  imageUrl: string | null;
  imageAlt: string | null;
  imagePlaceholder: string | null;
  choices: Array<{ id?: string; text: string }>;
  orderedItems: string[];
  numericMin: number;
  numericMax: number;
  numericAnswer: number;
  multipleSelection: boolean;
  timeLimitSec: number;
  points: number;
  slideLayout: NonNullable<LiveQuestionPayload["slideLayout"]>;
  slideBody: string;
  likertSteps: number;
  likertMinLabel: string;
  likertMaxLabel: string;
};

export type QuizEditorPreviewProps = {
  question: PreviewQuestion;
  answerPalette: LiveQuestionPayload["answerPalette"];
  position: string;
  questionIndex: number;
  totalQuestions: number;
  templateLabel: string;
  onClose: () => void;
};

function shuffleBySeed(items: string[], seed: string) {
  const hash = (value: string) => {
    let h = 0;
    for (let index = 0; index < value.length; index += 1) h = (h * 31 + value.charCodeAt(index)) | 0;
    return h;
  };
  return items
    .map((item, index) => ({ item, key: hash(`${seed}:${index}:${item}`) }))
    .sort((left, right) => left.key - right.key)
    .map((entry) => entry.item);
}

// 실제 학생 화면 두 종류는 퀴즈 편집기에서 가장 큰 선택 기능입니다. 이 파일 자체를 동적
// 청크로 두어 교사가 미리보기를 누르기 전에는 play-session/socket.io와 라이브 UI를 받지 않습니다.
export function QuizEditorPreview({ question, answerPalette, position, questionIndex, totalQuestions, templateLabel, onClose }: QuizEditorPreviewProps) {
  const [variant, setVariant] = useState<"game" | "light">("game");
  const [startedAt, setStartedAt] = useState(() => new Date().toISOString());
  const payload = useMemo<LiveQuestionPayload>(() => ({
    questionId: question.clientId,
    type: question.type,
    questionIndex,
    totalQuestions,
    text: question.type === "SLIDE" ? question.text : question.text.trim() || "(질문 없음)",
    imageUrl: question.imageUrl,
    imageAlt: question.imageAlt,
    imagePlaceholder: question.imagePlaceholder,
    choices: question.choices.map((choice, index) => ({ id: choice.id ?? `preview-${index}`, text: choice.text || `보기 ${index + 1}` })),
    orderedItems: shuffleBySeed(question.orderedItems.map((item) => item.trim()).filter(Boolean), question.clientId),
    ...(question.type === "NUMERIC"
      ? (({ step, gridMin, gridMax }) => ({ numericMin: gridMin, numericMax: gridMax, numericStep: step }))(autoNumericGrid(question.numericMin, question.numericMax, question.numericAnswer))
      : { numericMin: question.numericMin, numericMax: question.numericMax, numericStep: null }),
    multipleSelection: question.multipleSelection,
    answerPalette,
    timeLimitSec: question.timeLimitSec,
    points: question.points,
    slideLayout: question.slideLayout,
    slideBody: question.slideBody || null,
    likertSteps: question.likertSteps,
    likertMinLabel: question.likertMinLabel,
    likertMaxLabel: question.likertMaxLabel,
    startedAt,
  }), [question, answerPalette, questionIndex, totalQuestions, startedAt]);

  function switchVariant(next: "game" | "light") {
    setVariant(next);
    setStartedAt(new Date().toISOString());
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-scrim/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-label="학생 화면 미리보기" onMouseDown={(event) => event.stopPropagation()} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] bg-surface-sunken p-5 shadow-2xl sm:max-w-5xl sm:rounded-[30px] sm:p-6">
        <header className="mb-5 flex items-center gap-3">
          <h2 className="text-lg font-black text-content">학생 화면 미리보기</h2>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl text-content-muted hover:bg-surface-hover" aria-label="닫기"><XIcon className="h-5 w-5" /></button>
        </header>
        <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-black text-content-muted ring-1 ring-line">{position}</span>
          <span className="rounded-full bg-brand-soft px-3 py-1.5 text-xs font-black text-brand-soft-fg">{templateLabel}</span>
          <div className="ml-1 inline-flex rounded-xl bg-surface p-1 ring-1 ring-line" role="group" aria-label="미리보기 모드">
            <button type="button" onClick={() => switchVariant("game")} aria-pressed={variant === "game"} className={`rounded-lg px-3 py-1.5 text-xs font-black ${variant === "game" ? "bg-brand-950 text-info-300" : "text-content-muted"}`}>라이브</button>
            <button type="button" onClick={() => switchVariant("light")} aria-pressed={variant === "light"} className={`rounded-lg px-3 py-1.5 text-xs font-black ${variant === "light" ? "bg-brand-950 text-info-300" : "text-content-muted"}`}>자율 풀이</button>
          </div>
        </div>
        {variant === "game" ? (
          <div className="live-game-surface flex min-h-[58dvh] flex-col overflow-hidden rounded-[28px] p-3 text-white sm:p-5">
            <PlayerQuestionStage key={startedAt} question={payload} onSubmit={() => undefined} />
          </div>
        ) : question.type === "SLIDE" ? (
          <div className="flex min-h-[58dvh] flex-col rounded-[28px] border border-line bg-white p-4 text-content sm:p-6">
            <div className="min-h-0 flex-1"><ContentSlide question={payload} variant="light" /></div>
            <span className="mx-auto mt-4 grid min-h-13 w-full max-w-xl shrink-0 place-items-center rounded-2xl bg-brand-950 px-6 text-sm font-black text-on-brand">다음</span>
          </div>
        ) : (
          <div className="flex min-h-[58dvh] flex-col rounded-[28px] border border-line bg-white p-4 text-content sm:p-6">
            <AsyncQuestionContent key={startedAt} question={payload} disabled={false} onSubmit={() => undefined} />
          </div>
        )}
        <p className="mt-3 text-center text-[11px] font-bold text-content-subtle">실제 학생 화면과 같은 구성입니다. 답을 골라 봐도 제출되지는 않아요.</p>
      </section>
    </div>
  );
}
