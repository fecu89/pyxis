"use client";

import dynamic from "next/dynamic";
import { MessageSquare } from "lucide-react";
import { likertAverage } from "@/lib/quiz/likert";
import type { ParticipationSummary } from "@/lib/quiz/participation-summary";
import { wordCloudWeight, type WordCloudEntry } from "@/lib/quiz/word-cloud";

// 핀 분포는 이미지 좌표·SVG 편집 도구가 있는 큰 모듈입니다. 워드클라우드·리커트 결과만 보는
// 세션과 리포트에서는 받을 이유가 없으므로 DROP_PIN 결과가 실제로 있을 때만 내려받습니다.
const PinDistribution = dynamic(() => import("@/components/quiz/image-pin").then((module) => module.PinDistribution), { ssr: false });

// 참여형 문항의 결과 화면. 호스트 실시간 보기, 정답 공개 단계, 리포트가 모두 이 컴포넌트를
// 씁니다 — 같은 데이터를 세 곳에서 각자 그리면 화면마다 분포가 달라 보입니다.
//
// variant는 배경 대비만 바꿉니다. "game"은 어두운 무대 배경(LiveGameSurface) 위,
// "light"는 흰 카드(리포트) 위입니다.

type Variant = "game" | "light";

/* ------------------------------------------------------------- 워드 클라우드 */

// 빈도가 높을수록 크고 진하게. 크기와 색을 같은 weight 하나로 정해 "큰데 흐린 단어"가
// 생기지 않게 합니다.
const CLOUD_TONES_GAME = ["text-brand-100/50", "text-info-200/70", "text-info-200", "text-info-200", "text-info-300"];
const CLOUD_TONES_LIGHT = ["text-content-subtle", "text-info-600", "text-info-700", "text-brand-600", "text-brand-700"];

export function WordCloudView({ words, variant = "game", className = "" }: { words: WordCloudEntry[]; variant?: Variant; className?: string }) {
  if (!words.length) {
    return (
      <div className={`grid min-h-40 place-items-center rounded-2xl border border-dashed p-6 text-center ${variant === "game" ? "border-white/15 text-brand-100/50" : "border-line text-content-subtle"} ${className}`}>
        <div>
          <MessageSquare className="mx-auto h-7 w-7 opacity-50" aria-hidden="true" />
          <p className="mt-3 text-xs font-black">아직 모인 단어가 없어요</p>
        </div>
      </div>
    );
  }

  const maxCount = words[0].count;
  const minCount = words[words.length - 1].count;
  const tones = variant === "game" ? CLOUD_TONES_GAME : CLOUD_TONES_LIGHT;

  return (
    <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 ${className}`}>
      {words.map((entry) => {
        const weight = wordCloudWeight(entry.count, maxCount, minCount);
        // 0.95rem ~ 3.2rem. 최빈 단어가 화면을 다 먹지 않으면서도 한눈에 구분됩니다.
        const fontSize = 0.95 + weight * 2.25;
        const tone = tones[Math.min(tones.length - 1, Math.round(weight * (tones.length - 1)))];
        return (
          <span
            key={entry.word}
            title={`${entry.word} · ${entry.count}명`}
            className={`font-black leading-tight tracking-tight transition-all duration-500 ${tone}`}
            style={{ fontSize: `${fontSize}rem` }}
          >
            {entry.word}
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- 리커트 척도 */

export function LikertDistribution({ counts, steps, minLabel, maxLabel, variant = "game", className = "" }: {
  counts: number[];
  steps: number;
  minLabel: string | null;
  maxLabel: string | null;
  variant?: Variant;
  className?: string;
}) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const maxCount = Math.max(1, ...counts);
  const average = likertAverage(counts);
  const game = variant === "game";

  return (
    <div className={className}>
      <div className="flex items-end justify-between gap-1.5" style={{ minHeight: "8rem" }}>
        {Array.from({ length: steps }, (_, index) => {
          const count = counts[index] ?? 0;
          return (
            <div key={index} className="flex flex-1 flex-col items-center gap-1.5">
              <span className={`text-[11px] font-black tabular-nums ${game ? "text-brand-100/70" : "text-content-muted"}`}>{count || ""}</span>
              <div
                className={`w-full rounded-t-lg transition-all duration-500 ${game ? "bg-info-300" : "bg-brand-500"}`}
                style={{ height: `${Math.max(count ? 8 : 2, (count / maxCount) * 100)}%`, minHeight: count ? "0.5rem" : "0.25rem", opacity: count ? 1 : 0.25 }}
              />
              <span className={`text-[11px] font-black tabular-nums ${game ? "text-brand-100/60" : "text-content-subtle"}`}>{index + 1}</span>
            </div>
          );
        })}
      </div>
      <div className={`mt-2 flex items-start justify-between gap-3 text-[11px] font-bold ${game ? "text-brand-100/60" : "text-content-muted"}`}>
        <span className="max-w-[40%] text-left">{minLabel}</span>
        <span className="shrink-0 font-black">
          {total ? `평균 ${average?.toFixed(2)} · ${total}명` : "응답 없음"}
        </span>
        <span className="max-w-[40%] text-right">{maxLabel}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ 통합 렌더러 */

/**
 * 집계 종류에 맞는 화면을 고릅니다. 설문(SURVEY)은 기존 보기 분포 UI가 이미 있어 여기서
 * 다루지 않고, 호출부가 choiceBreakdown을 그대로 씁니다.
 */
export function ParticipationSummaryView({ summary, question, variant = "game", className = "" }: {
  summary: ParticipationSummary | null;
  question: { imageUrl?: string | null; imageAlt?: string | null; likertMinLabel?: string | null; likertMaxLabel?: string | null };
  variant?: Variant;
  className?: string;
}) {
  if (!summary) return null;

  if (summary.type === "WORD_CLOUD") {
    return <WordCloudView words={summary.words} variant={variant} className={className} />;
  }

  if (summary.type === "LIKERT") {
    return (
      <LikertDistribution
        counts={summary.counts}
        steps={summary.steps}
        minLabel={question.likertMinLabel ?? null}
        maxLabel={question.likertMaxLabel ?? null}
        variant={variant}
        className={className}
      />
    );
  }

  if (summary.type === "DROP_PIN") {
    if (!question.imageUrl) return null;
    return (
      <div className={className}>
        <PinDistribution imageUrl={question.imageUrl} imageAlt={question.imageAlt ?? null} pins={summary.pins.map((point) => ({ point }))} />
        <p className={`mt-2 text-center text-[11px] font-bold ${variant === "game" ? "text-brand-100/60" : "text-content-muted"}`}>
          {summary.totalAnswered}명이 핀을 놓았어요
        </p>
      </div>
    );
  }

  return null;
}
