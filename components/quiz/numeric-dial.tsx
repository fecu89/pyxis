"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { formatNumericStep, numericStopCount, snapNumericValue } from "@/lib/quiz/numeric";

// NUMERIC 답안용 다이얼 슬라이더. 고정된 중앙 마커 아래로 눈금 띠를 드래그해 값을 고릅니다.
// 직접 입력을 없앤 대신(입력이 가능하면 단답형과 다를 게 없어서) 조작감이 중요해,
// 놓는 순간의 속도로 계속 굴러가다 마찰로 감속하는 관성(iOS 스크롤 방식)을 넣었습니다.
// 눈금이 수만 개인 극단 케이스도 버티도록 눈금은 반복 그라디언트로, 라벨은 보이는 창 안의
// 것만 골라 그립니다(눈금 개수만큼 DOM을 만들지 않습니다).

const TICK_PX = 18;
/** 관성 감속 시간 상수(ms). 클수록 멀리 굴러갑니다 — iOS 감각에 맞춘 값. */
const FRICTION_TAU_MS = 325;
/** 이 속도(px/ms) 아래로 떨어지면 가장 가까운 눈금으로 정착을 시작합니다. */
const SETTLE_SPEED = 0.015;

function formatValue(value: number) {
  return Math.abs(value) >= 10_000 && Number.isInteger(value) ? value.toLocaleString("ko-KR") : String(value);
}

export function NumericDial({ min, max, step, disabled, variant, defaultValue, onValueChange }: {
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  variant: "game" | "light";
  defaultValue: number;
  onValueChange: (value: number) => void;
}) {
  const game = variant === "game";
  const lastIndex = Math.max(1, numericStopCount(min, max, step) - 1);
  const toIndex = (value: number) => Math.max(0, Math.min(lastIndex, (snapNumericValue(value, min, max, step) - min) / step));
  const toValue = (index: number) => snapNumericValue(min + Math.round(index) * step, min, max, step);

  const [position, setPosition] = useState(() => toIndex(defaultValue));
  const positionRef = useRef(position);
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripWidth, setStripWidth] = useState(0);
  const dragRef = useRef<{ pointerId: number; lastX: number; samples: { time: number; x: number }[] } | null>(null);
  const frameRef = useRef<number | null>(null);
  const reportedRef = useRef(toValue(position));

  const move = (next: number) => {
    const clamped = Math.max(0, Math.min(lastIndex, next));
    positionRef.current = clamped;
    setPosition(clamped);
    const value = toValue(clamped);
    if (value !== reportedRef.current) {
      reportedRef.current = value;
      onValueChange(value);
      if (dragRef.current) navigator.vibrate?.(3);
    }
    return clamped;
  };

  const stopMotion = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  /** 정착: 가장 가까운(또는 지정한) 눈금으로 짧게 미끄러져 붙습니다. */
  const settleTo = (targetIndex: number) => {
    stopMotion();
    const target = Math.max(0, Math.min(lastIndex, Math.round(targetIndex)));
    let lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - lastTime);
      lastTime = now;
      const current = positionRef.current;
      const next = current + (target - current) * Math.min(1, dt / 90);
      if (Math.abs(next - target) < 0.002) {
        move(target);
        frameRef.current = null;
        return;
      }
      move(next);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  /** 관성: 놓은 순간 속도(px/ms)로 굴러가며 지수 감속, 충분히 느려지면 눈금에 정착합니다. */
  const glide = (velocityPx: number) => {
    stopMotion();
    let velocity = velocityPx;
    let lastTime = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(48, now - lastTime);
      lastTime = now;
      const next = positionRef.current - velocity * dt / TICK_PX;
      const clamped = move(next);
      if (clamped !== next) velocity = 0; // 경계에 닿으면 그 자리에 멈춥니다.
      velocity *= Math.exp(-dt / FRICTION_TAU_MS);
      if (Math.abs(velocity) < SETTLE_SPEED) {
        settleTo(positionRef.current);
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => stopMotion(), []);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const sync = () => setStripWidth(strip.clientWidth);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || !event.isPrimary) return;
    event.preventDefault();
    stopMotion();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, samples: [{ time: performance.now(), x: event.clientX }] };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.lastX;
    drag.lastX = event.clientX;
    move(positionRef.current - dx / TICK_PX);
    const now = performance.now();
    drag.samples.push({ time: now, x: event.clientX });
    while (drag.samples.length > 2 && now - drag.samples[0].time > 90) drag.samples.shift();
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const elapsed = last.time - first.time;
    const velocity = elapsed > 15 ? (last.x - first.x) / elapsed : 0;
    if (Math.abs(velocity) > 0.08) glide(velocity);
    else settleTo(positionRef.current);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const current = Math.round(positionRef.current);
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); settleTo(current - 1); }
    else if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); settleTo(current + 1); }
    else if (event.key === "Home") { event.preventDefault(); settleTo(0); }
    else if (event.key === "End") { event.preventDefault(); settleTo(lastIndex); }
  }

  const value = toValue(position);
  const centerPx = stripWidth / 2;
  const offsetPx = centerPx - position * TICK_PX;

  // 라벨은 64px 이상 간격이 되도록 1-2-5 사다리에서 고르고, 보이는 범위만 그립니다.
  const labelEvery = [1, 2, 5, 10, 20, 50, 100].find((count) => count * TICK_PX >= 64) ?? 100;
  const labels: { index: number; left: number }[] = [];
  if (stripWidth > 0) {
    const halfSpan = centerPx / TICK_PX + labelEvery;
    for (let index = Math.max(0, Math.ceil((position - halfSpan) / labelEvery) * labelEvery); index <= Math.min(lastIndex, position + halfSpan); index += labelEvery) {
      labels.push({ index, left: index * TICK_PX + offsetPx });
    }
  }

  const minorTick = game ? "rgba(255,255,255,.22)" : "rgba(100,116,139,.35)";
  const majorTick = game ? "rgba(255,255,255,.6)" : "rgba(71,85,105,.7)";

  return (
    <div className={disabled ? "opacity-60" : ""}>
      <div className="flex items-end justify-center gap-2">
        <span className={`font-mono text-[clamp(2.4rem,9vw,3.6rem)] font-black leading-none tracking-tight ${game ? "text-white" : "text-brand-950"}`} aria-hidden="true">{formatValue(value)}</span>
      </div>
      <div className={`mt-1 flex items-center justify-center gap-2 text-[10px] font-black ${game ? "text-brand-100/50" : "text-content-subtle"}`}>
        <span className={`rounded-full px-2.5 py-1 ${game ? "bg-white/10 text-brand-100/70" : "bg-surface-sunken text-content-muted"}`}>{formatNumericStep(step)} 단위</span>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <span className={`shrink-0 text-xs font-black ${game ? "text-brand-100/55" : "text-content-muted"}`}>{formatValue(min)}</span>
        <div
          ref={stripRef}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-label="숫자 다이얼 — 좌우로 끌어서 값을 고르세요"
          aria-disabled={disabled}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onKeyDown}
          style={{ touchAction: "none" }}
          className={`relative h-20 min-w-0 flex-1 select-none overflow-hidden rounded-2xl outline-none ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"} ${game ? "bg-brand-950/50 focus-visible:ring-2 focus-visible:ring-info-300" : "bg-white ring-1 ring-line focus-visible:ring-2 focus-visible:ring-brand-500"}`}
        >
          {/* 잔눈금·굵은눈금: 반복 그라디언트라 눈금 수와 무관하게 일정 비용 */}
          <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-4 -translate-y-1/2" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${minorTick} 0 2px, transparent 2px ${TICK_PX}px)`, backgroundPositionX: `${offsetPx - 1}px` }} />
          <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${majorTick} 0 2px, transparent 2px ${labelEvery * TICK_PX}px)`, backgroundPositionX: `${offsetPx - 1}px` }} />
          {labels.map(({ index, left }) => (
            <span key={index} aria-hidden="true" className={`absolute bottom-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold ${game ? "text-brand-100/45" : "text-content-subtle"}`} style={{ left }}>{formatValue(toValue(index))}</span>
          ))}
          {/* 중앙 마커 */}
          <div aria-hidden="true" className={`pointer-events-none absolute inset-y-2 left-1/2 w-[3px] -translate-x-1/2 rounded-full ${game ? "bg-info-300 shadow-[0_0_16px_rgba(112,232,238,.8)]" : "bg-brand-600 shadow-[0_0_12px_rgba(0,114,201,.5)]"}`} />
          {/* 가장자리 페이드 */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: game ? "linear-gradient(90deg, rgba(4,42,76,.9), transparent 18%, transparent 82%, rgba(4,42,76,.9))" : "linear-gradient(90deg, #fff, transparent 18%, transparent 82%, #fff)" }} />
        </div>
        <span className={`shrink-0 text-xs font-black ${game ? "text-brand-100/55" : "text-content-muted"}`}>{formatValue(max)}</span>
      </div>
    </div>
  );
}
