"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { TrophyIcon } from "@/components/ui/icons";
import { useQuizScoreSound } from "@/components/quiz/live-audio-context";

export type LeaderboardEntry = {
  participantId: string;
  nickname: string;
  score: number;
  rank: number;
  previousRank: number;
  previousScore: number;
};

export type Leaderboard = LeaderboardEntry[];

// 화면에 실제로 "보이는" 자리는 TOP 3뿐입니다. 서버는 이탈자·진입자를 함께 보내려고 최대
// 6명(현재 TOP 3 ∪ 이전 TOP 3)을 내려주지만, 그중 화면에 자리(row)를 갖는 건 always 3개뿐이고
// 나머지는 3행 아래로 빠지며 사라집니다.
const VISIBLE_LIMIT = 3;

// 메달은 브랜드가 파랑으로 바뀌어도 금·은·동으로 남깁니다 — 1·2·3위를 한눈에 가르는 게 이
// 색의 유일한 일이고, 셋을 브랜드 계열의 명도 단계로 바꾸면 "파란 띠 세 개"가 되어 등수 구분이
// 사라집니다(순위가 자주 뒤집히는 화면이라 특히 치명적입니다). 대신 판 자체의 chrome은 아래에서
// 금색을 걷어내고 중립 토큰으로 옮겨, 골드는 메달에만 남게 했습니다.
const medalStyles = [
  "border-amber-300 bg-gradient-to-r from-amber-50 to-yellow-100 text-amber-950",
  "border-slate-300 bg-gradient-to-r from-slate-50 to-slate-200 text-slate-900",
  "border-orange-300 bg-gradient-to-r from-orange-50 to-orange-100 text-orange-950",
] as const;

export function CountUpNumber({ from, to, duration = 900, className }: { from: number; to: number; duration?: number; className?: string }) {
  const [value, setValue] = useState(from);
  const playScoreTick = useQuizScoreSound();
  const playScoreTickRef = useRef(playScoreTick);
  const previousValueRef = useRef(from);

  useEffect(() => {
    playScoreTickRef.current = playScoreTick;
  }, [playScoreTick]);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startedAt = performance.now();
    let frameId = 0;

    function update(now: number) {
      const progress = reduceMotion ? 1 : Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (to - from) * eased);
      setValue(next);
      if (to > from && next > previousValueRef.current) playScoreTickRef.current();
      previousValueRef.current = next;
      if (progress < 1) frameId = window.requestAnimationFrame(update);
    }

    previousValueRef.current = from;
    frameId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frameId);
  }, [duration, from, to]);

  return <span className={className}>{value.toLocaleString("ko-KR")}</span>;
}

/** rank가 TOP 3 안이면 그 행 인덱스(0~2), 아니면 3(3행 바로 아래, 화면 밖). */
function rowIndexFor(rank: number) {
  return rank >= 1 && rank <= VISIBLE_LIMIT ? rank - 1 : VISIBLE_LIMIT;
}

export function LiveLeaderboard({ entries, title = "TOP 3", variant = "panel" }: { entries: Leaderboard; title?: string; variant?: "panel" | "stage" }) {
  const stage = variant === "stage";
  // FLIP(First-Last-Invert-Play): 새 entries가 들어오면 먼저 이전 순위(previousRank) 자리에
  // transition 없이 그리고("enter"), 다음 두 프레임 뒤에 현재 순위(rank) 자리로 전환합니다
  // ("settled") — 브라우저가 실제로 두 자리 사이를 애니메이션할 시간(paint 경계)을 갖습니다.
  const signature = entries.map((entry) => `${entry.participantId}:${entry.rank}:${entry.previousRank}:${entry.score}`).join("|");
  const [settled, setSettled] = useState(false);
  // entries 구성(참가자·순위·점수)이 실제로 바뀌면 다시 "enter" 상태로 되돌립니다. effect 안에서
  // setState를 동기 호출하면 렌더가 겹치므로(react-hooks/set-state-in-effect), 리액트 문서가
  // 권장하는 "prop이 바뀌면 렌더 중 state를 조정" 패턴을 씁니다 — effect가 아니라 렌더 본문에서
  // 조건부로 리셋합니다.
  const [trackedSignature, setTrackedSignature] = useState(signature);
  if (signature !== trackedSignature) {
    setTrackedSignature(signature);
    setSettled(false);
  }

  useEffect(() => {
    // prefers-reduced-motion에서는 globals.css의 media query가 transition 자체를 없애므로
    // (.live-leaderboard-card 참고) enter→settled 전환을 건너뛸 필요가 없습니다 — 위치는
    // 그대로 즉시 최종 자리로 "점프"합니다.
    if (settled) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [settled]);

  return (
    <section className={`overflow-hidden ${stage ? "rounded-[30px] border border-white/10 bg-white/[0.07] shadow-2xl backdrop-blur-sm" : "rounded-[26px] border border-line bg-surface shadow-lg shadow-content/5"}`} aria-live="polite" aria-label="상위 3명 순위">
      <div className={`flex items-center gap-2 ${stage ? "border-b border-white/10 p-5 sm:px-7 sm:py-6" : "border-b border-line bg-surface-muted p-5"}`}>
        <TrophyIcon className={`h-5 w-5 ${stage ? "text-info-300" : "text-warning-soft-fg"}`} />
        <div>
          <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${stage ? "text-info-200" : "text-content-muted"}`}>Leaderboard</p>
          <h3 className={`mt-0.5 font-black ${stage ? "text-xl text-white sm:text-2xl" : "text-sm text-content"}`}>{title}</h3>
        </div>
      </div>
      {entries.length > 0 ? (
        <div className={stage ? "p-3 sm:p-5" : "p-3"}>
          <ol className="live-leaderboard-rows" data-variant={variant}>
            {entries.map((entry) => {
              const displayRank = settled ? entry.rank : entry.previousRank;
              const visible = displayRank >= 1 && displayRank <= VISIBLE_LIMIT;
              const leaving = entry.rank > VISIBLE_LIMIT;
              const movement = entry.previousRank > entry.rank ? "up" : entry.previousRank < entry.rank ? "down" : "same";
              return (
                <li
                  key={entry.participantId}
                  aria-hidden={leaving && settled ? true : undefined}
                  data-phase={settled ? "settled" : "enter"}
                  style={{ "--row-index": rowIndexFor(displayRank), "--row-opacity": visible ? 1 : 0 } as CSSProperties}
                  className={`live-leaderboard-card flex items-center gap-3 border shadow-sm ${stage ? "rounded-[22px] border-white/15 bg-white/[0.09] px-4 py-4 text-white sm:px-6" : `rounded-2xl px-4 py-3.5 ${medalStyles[entry.rank - 1] ?? medalStyles[2]}`}`}
                >
                  <span className={`grid shrink-0 place-items-center font-black shadow-sm ${stage ? `h-12 w-12 rounded-2xl text-xl ${entry.rank === 1 ? "bg-info-300 text-brand-950" : entry.rank === 2 ? "bg-white text-content" : "bg-brand-200 text-brand-950"}` : "h-9 w-9 rounded-xl bg-white/80 text-sm"}`}>{entry.rank}</span>
                  {stage ? <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-base font-black">{entry.nickname.slice(0, 1)}</span> : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={`truncate font-black ${stage ? "text-lg sm:text-2xl" : "text-sm"}`}>{entry.nickname}</p>
                      {movement !== "same" ? <span className={`rounded-full px-2 py-1 text-[10px] font-black ${movement === "up" ? stage ? "bg-info-300/15 text-info-200" : "text-brand-700" : stage ? "bg-danger-400/15 text-danger-200" : "text-danger"}`} aria-label={movement === "up" ? `${entry.previousRank - entry.rank}단계 상승` : `${entry.rank - entry.previousRank}단계 하락`}>{movement === "up" ? `↑${entry.previousRank - entry.rank}` : `↓${entry.rank - entry.previousRank}`}</span> : null}
                    </div>
                    <p className={`mt-1 font-bold opacity-55 ${stage ? "text-xs" : "text-[10px]"}`}>이전 {entry.previousRank}위</p>
                  </div>
                  <p className={`shrink-0 font-mono font-black ${stage ? "text-xl text-info-200 sm:text-3xl" : "text-sm"}`}>
                    {/* 점수 카운트업은 매 애니메이션 프레임마다 텍스트가 바뀌어, aria-live 영역
                        안에 그대로 두면 스크린리더가 그 값을 계속 다시 읽습니다. 애니메이션 자체는
                        시각 효과로 숨기고, 최종 값만 정적 텍스트로 한 번 노출합니다. */}
                    <span aria-hidden="true"><CountUpNumber from={entry.previousScore} to={entry.score} />점</span>
                    <span className="sr-only">{entry.score.toLocaleString("ko-KR")}점</span>
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      ) : <p className={`p-8 text-center text-xs font-bold ${stage ? "text-brand-100/50" : "text-content-subtle"}`}>아직 순위가 없습니다.</p>}
    </section>
  );
}
