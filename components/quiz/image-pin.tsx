"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { TrashIcon } from "@/components/ui/icons";
import { pinAreaLabel, simplifyPolygon, type PinArea, type PinPoint } from "@/lib/quiz/image-pin";

// 이미지 위에 핀을 꽂는 문항(핀 고정형·드롭 핀)의 화면 셋. 편집기(정답 영역 그리기),
// 학생 응답(핀 끌어다 놓기), 결과(핀 분포)가 같은 좌표 변환과 같은 SVG 오버레이를 공유합니다.
// 세 곳이 각자 좌표를 계산하면 "편집기에서 그린 영역"과 "학생이 찍은 위치"가 미세하게 어긋나
// 채점이 틀어집니다.
//
// 모든 좌표는 0~1 정규화 값입니다(lib/quiz/image-pin.ts 참고). 화면 픽셀은 이 파일 밖으로
// 나가지 않습니다.

export type PinTool = "RECT" | "CIRCLE" | "POLYGON";

const AREA_FILL = "rgba(0, 185, 193, 0.28)";
const AREA_STROKE = "rgb(0, 150, 156)";

/** 포인터 위치를 이미지 기준 0~1 좌표로 바꿉니다. 이미지 밖으로 나가면 가장자리에 붙입니다. */
function toRatio(element: HTMLElement, clientX: number, clientY: number): PinPoint {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(rect.width, 1))),
    y: Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(rect.height, 1))),
  };
}

function polygonPoints(points: PinPoint[]) {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

/** 이미지 + 그 위에 정확히 겹치는 SVG 오버레이. viewBox가 0~100이라 정규화 좌표를 %로 바로 씁니다. */
function PinFrame({
  imageUrl,
  imageAlt,
  children,
  htmlOverlay,
  overlayRef,
  onAspect,
  fit = false,
  fitMaxHeightVh,
  className = "",
  ...handlers
}: {
  imageUrl: string;
  imageAlt: string | null;
  children?: React.ReactNode;
  htmlOverlay?: React.ReactNode;
  overlayRef?: React.RefObject<HTMLDivElement | null>;
  onAspect?: (aspect: number) => void;
  fit?: boolean;
  fitMaxHeightVh?: number;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const fitRef = useRef<HTMLDivElement | null>(null);
  const [aspect, setAspect] = useState(3 / 2);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const { style, ...frameHandlers } = handlers;

  useEffect(() => {
    if (!fit || !fitRef.current) return;
    const element = fitRef.current;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setBounds((current) => current.width === rect.width && current.height === rect.height
        ? current
        : { width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  const availableHeight = fitMaxHeightVh && typeof window !== "undefined"
    ? Math.min(bounds.height, window.innerHeight * fitMaxHeightVh / 100)
    : bounds.height;
  const fittedWidth = fit && bounds.width > 0 && availableHeight > 0
    ? Math.min(bounds.width, availableHeight * aspect)
    : null;
  const fittedHeight = fittedWidth === null ? null : fittedWidth / aspect;
  const frame = (
    <div
      ref={overlayRef}
      className={`relative select-none overflow-hidden rounded-2xl bg-surface-muted ${fit ? "shrink-0" : "w-full"} ${className}`}
      style={fit && fittedWidth !== null && fittedHeight !== null
        ? { width: fittedWidth, height: fittedHeight, ...style }
        : { aspectRatio: aspect, ...style }}
      {...frameHandlers}
    >
      {/* 원본 비율을 유지해야 정규화 좌표가 화면과 일치합니다 — object-cover로 잘리면 어긋납니다. */}
      <Image
        src={imageUrl}
        alt={imageAlt || "핀을 놓을 이미지"}
        fill
        sizes="(max-width: 768px) 100vw, 720px"
        unoptimized
        draggable={false}
        onLoad={(event) => {
          const target = event.currentTarget;
          if (target.naturalHeight > 0) {
            const nextAspect = target.naturalWidth / target.naturalHeight;
            setAspect(nextAspect);
            onAspect?.(nextAspect);
          }
        }}
        className="pointer-events-none select-none object-contain"
      />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        {children}
      </svg>
      {htmlOverlay ? <div className="pointer-events-none absolute inset-0">{htmlOverlay}</div> : null}
    </div>
  );

  if (!fit) return frame;
  return <div ref={fitRef} className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden">{frame}</div>;
}

function PinAreaShape({ area, fill, stroke, strokeWidth, className, opacity }: {
  area: PinArea;
  fill: string;
  stroke: string;
  strokeWidth: number;
  className?: string;
  opacity?: number;
}) {
  const style = { fill, stroke, strokeWidth, className, opacity, vectorEffect: "non-scaling-stroke" as const };
  if (area.shape === "RECT") {
    return <rect x={area.x * 100} y={area.y * 100} width={area.width * 100} height={area.height * 100} {...style} />;
  }
  if (area.shape === "CIRCLE") {
    // 두 반지름이 이미 x·y 각 축의 비율이라 그대로 씁니다(lib/quiz/image-pin.ts 판정식과 동일).
    return <ellipse cx={area.x * 100} cy={area.y * 100} rx={area.radiusX * 100} ry={area.radiusY * 100} {...style} />;
  }
  return <polygon points={polygonPoints(area.points)} {...style} />;
}

function AreaShapes({ areas, emphasized = false }: { areas: PinArea[]; emphasized?: boolean }) {
  if (emphasized) {
    return (
      <>
        {/* 사진의 맥락은 보이되 정답 영역이 먼저 읽히도록 공개 단계에서만 전체를 살짝 낮춥니다. */}
        {areas.length ? <rect x={0} y={0} width={100} height={100} fill="rgba(2, 24, 18, 0.28)" /> : null}
        {areas.map((area, index) => (
          <PinAreaShape key={`halo-${index}`} area={area} fill="transparent" stroke="rgba(112, 232, 238, 0.9)" strokeWidth={5} className="pin-answer-area-halo" />
        ))}
        {areas.map((area, index) => (
          <PinAreaShape key={index} area={area} fill="rgba(112, 232, 238, 0.48)" stroke="rgba(255, 255, 255, 0.98)" strokeWidth={1.6} />
        ))}
      </>
    );
  }

  return (
    <>
      {areas.map((area, index) => <PinAreaShape key={index} area={area} fill={AREA_FILL} stroke={AREA_STROKE} strokeWidth={0.5} />)}
    </>
  );
}

/* ------------------------------------------------------------------ 편집기 */

/**
 * 출제자가 정답 영역을 그립니다. 도구에 따라 드래그의 뜻이 달라집니다 —
 * 직사각형은 대각선, 원은 중심에서 반지름, 자유형은 그린 궤적입니다.
 */
export function PinAreaEditor({ imageUrl, imageAlt, areas, onChange }: {
  imageUrl: string;
  imageAlt: string | null;
  areas: PinArea[];
  onChange: (areas: PinArea[]) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<PinTool>("RECT");
  // 화면에 그려진 원을 정규화 좌표의 타원으로 바꾸는 데만 씁니다. 저장되는 값은 두 축 반지름이라
  // 채점 시점에는 비율이 필요 없습니다.
  const [aspect, setAspect] = useState(1);
  const [draft, setDraft] = useState<{ start: PinPoint; current: PinPoint; path: PinPoint[] } | null>(null);

  const pointFrom = useCallback((event: React.PointerEvent) => {
    return frameRef.current ? toRatio(frameRef.current, event.clientX, event.clientY) : null;
  }, []);

  function handleDown(event: React.PointerEvent) {
    if (areas.length >= 10) return;
    const point = pointFrom(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ start: point, current: point, path: [point] });
  }

  function handleMove(event: React.PointerEvent) {
    if (!draft) return;
    const point = pointFrom(event);
    if (!point) return;
    setDraft((current) => (current ? { ...current, current: point, path: [...current.path, point] } : current));
  }

  function handleUp() {
    if (!draft) return;
    const next = buildArea(tool, draft, aspect);
    setDraft(null);
    if (next) onChange([...areas, next]);
  }

  const draftArea = draft ? buildArea(tool, draft, aspect, true) : null;
  const full = areas.length >= 10;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-surface-muted p-1">
          {([["RECT", "직사각형"], ["CIRCLE", "원형"], ["POLYGON", "자유형"]] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setTool(value)} className={`min-h-9 rounded-lg px-3 text-xs font-black transition ${tool === value ? "bg-surface text-brand shadow-sm" : "text-content-muted hover:text-content"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-semibold text-content-subtle">
          {full ? "영역은 최대 10개까지 그릴 수 있습니다" : tool === "RECT" ? "이미지 위를 대각선으로 끌어 사각형을 그립니다" : tool === "CIRCLE" ? "중심에서 바깥으로 끌어 원을 그립니다" : "손으로 그리듯 끌어 영역을 감쌉니다"}
        </span>
        {areas.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-black text-danger transition hover:bg-danger-soft">
            <TrashIcon className="h-3.5 w-3.5" />전체 지우기
          </button>
        )}
      </div>

      {/* 도구·영역 목록·완료 버튼까지 한 화면에서 확인할 수 있도록 편집 이미지를 뷰포트
          높이에 맞춥니다. PinFrame이 실제 남은 가로·세로 중 작은 쪽에 맞추므로 좌표는 그대로입니다. */}
      <div className="h-[min(52dvh,34rem)] w-full">
        <PinFrame
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          overlayRef={frameRef}
          onAspect={setAspect}
          fit
          fitMaxHeightVh={52}
          className={`touch-none ${full ? "" : "cursor-crosshair"}`}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
        >
          <AreaShapes areas={areas} />
          {draftArea ? <AreaShapes areas={[draftArea]} /> : null}
        </PinFrame>
      </div>

      {areas.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {areas.map((area, index) => (
            <li key={index} className="inline-flex items-center gap-2 rounded-xl bg-brand-soft px-3 py-1.5 text-[11px] font-black text-brand-soft-fg">
              {pinAreaLabel(area)}
              <button type="button" onClick={() => onChange(areas.filter((_, entry) => entry !== index))} className="grid h-5 w-5 place-items-center rounded-md text-brand-soft-fg/70 transition hover:bg-white/60 hover:text-danger" aria-label={`${index + 1}번 영역 삭제`}>
                <TrashIcon className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs font-bold text-content-subtle">아직 정답 영역이 없습니다. 이미지 위를 끌어서 그려 주세요. 여러 개를 그리면 그중 하나만 맞혀도 정답입니다.</p>
      )}
    </div>
  );
}

/**
 * 드래그 상태를 영역으로 확정합니다. 너무 작은 영역은 오조작이라 버립니다(preview는 미리보기라 통과).
 *
 * 원은 화면에서 진짜 원으로 보여야 하므로, 픽셀 기준 반지름을 이미지 비율로 나눠 x·y 각 축의
 * 정규화 반지름으로 바꿉니다.
 */
function buildArea(tool: PinTool, draft: { start: PinPoint; current: PinPoint; path: PinPoint[] }, aspect: number, preview = false): PinArea | null {
  if (tool === "RECT") {
    const x = Math.min(draft.start.x, draft.current.x);
    const y = Math.min(draft.start.y, draft.current.y);
    const width = Math.abs(draft.current.x - draft.start.x);
    const height = Math.abs(draft.current.y - draft.start.y);
    if (!preview && (width < 0.02 || height < 0.02)) return null;
    return { shape: "RECT", x, y, width, height };
  }
  if (tool === "CIRCLE") {
    const dx = draft.current.x - draft.start.x;
    const dy = draft.current.y - draft.start.y;
    // 픽셀 거리를 너비로 나눈 값 = 가로 반지름. 세로 반지름은 거기에 비율을 곱합니다.
    const radiusX = Math.hypot(dx, dy / Math.max(aspect, Number.EPSILON));
    const radiusY = radiusX * aspect;
    if (!preview && radiusX < 0.015) return null;
    return { shape: "CIRCLE", x: draft.start.x, y: draft.start.y, radiusX: Math.min(1, Math.max(0.002, radiusX)), radiusY: Math.min(1, Math.max(0.002, radiusY)) };
  }
  const points = simplifyPolygon(draft.path);
  if (points.length < 3) return null;
  return { shape: "POLYGON", points };
}

/* ------------------------------------------------------------- 학생 응답 */

/**
 * 이미지 바깥의 핀을 끌어다 이미지 위에 놓습니다.
 *
 * 드래그만 지원하면 보조기기·키보드 사용자가 답할 수 없어, 이미지를 직접 눌러도(그리고 누른 채
 * 끌어도) 그 자리에 핀이 놓이게 했습니다. 놓은 뒤에도 제출 전까지는 몇 번이든 다시 옮길 수 있습니다.
 */
export function ImagePinAnswer({ imageUrl, imageAlt, disabled, variant = "game", onSubmit }: {
  imageUrl: string;
  imageAlt: string | null;
  disabled: boolean;
  variant?: "game" | "light";
  onSubmit: (point: PinPoint) => void;
}) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [point, setPoint] = useState<PinPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const game = variant === "game";

  const place = useCallback((clientX: number, clientY: number) => {
    if (!frameRef.current) return;
    setPoint(toRatio(frameRef.current, clientX, clientY));
  }, []);

  function startDrag(event: React.PointerEvent) {
    if (disabled) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setDragging(true);
    place(event.clientX, event.clientY);
  }

  function moveDrag(event: React.PointerEvent) {
    if (!dragging || disabled) return;
    place(event.clientX, event.clientY);
  }

  function endDrag() {
    setDragging(false);
  }

  return (
    <div className={game ? "flex h-full min-h-0 w-full flex-col" : "w-full"}>
      {/* 핀 아이콘은 오버레이 SVG가 아니라 절대 배치한 DOM 요소입니다 — viewBox 스케일에
          눌리면 이미지 비율에 따라 핀이 찌그러집니다. */}
      <div className={`relative ${game ? "min-h-0 flex-1" : ""}`}>
        <PinFrame
          imageUrl={imageUrl}
          imageAlt={imageAlt}
          overlayRef={frameRef}
          fit={game}
          fitMaxHeightVh={game ? 46 : undefined}
          htmlOverlay={point ? <PinMarker point={point} /> : null}
          className={`touch-none ${disabled ? "" : "cursor-crosshair"}`}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {point ? (
            <>
              {/* 놓인 자리를 십자선으로도 표시합니다 — 핀 그림만으로는 정확히 어느 점인지 애매합니다. */}
              <line x1={point.x * 100} y1={0} x2={point.x * 100} y2={100} stroke={game ? "rgba(255,255,255,.55)" : "rgba(15,23,42,.35)"} strokeWidth={0.4} vectorEffect="non-scaling-stroke" strokeDasharray="2 2" />
              <line x1={0} y1={point.y * 100} x2={100} y2={point.y * 100} stroke={game ? "rgba(255,255,255,.55)" : "rgba(15,23,42,.35)"} strokeWidth={0.4} vectorEffect="non-scaling-stroke" strokeDasharray="2 2" />
            </>
          ) : null}
        </PinFrame>
      </div>

      <div className="mt-2 flex shrink-0 items-center justify-between gap-3 sm:mt-3">
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label="핀을 끌어 이미지 위에 놓으세요"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`inline-flex min-h-10 touch-none items-center gap-2 rounded-2xl border-2 border-dashed px-3 text-xs font-black transition sm:min-h-12 sm:px-4 sm:text-sm ${
            disabled
              ? game ? "border-white/15 opacity-50" : "border-line opacity-50"
              : dragging
                ? game ? "border-info-300 bg-info-300/20 text-info-100" : "border-brand-500 bg-brand-50 text-brand-800"
                : game ? "border-white/25 bg-white/10 hover:border-info-300/60" : "border-line-strong bg-surface-muted text-content hover:border-brand-400"
          }`}
        >
          <MapPin className={`h-5 w-5 ${point ? (game ? "text-info-300" : "text-brand-600") : ""}`} aria-hidden="true" />
          {point ? "핀 위치 바꾸기" : "핀을 끌어 놓기"}
        </div>
        <p className={`hidden text-right text-[11px] font-bold sm:block ${game ? "opacity-60" : "text-content-subtle"}`}>
          {point ? `가로 ${Math.round(point.x * 100)}% · 세로 ${Math.round(point.y * 100)}%` : "이미지를 직접 눌러도 됩니다"}
        </p>
      </div>

      <button
        type="button"
        disabled={disabled || !point}
        onClick={() => point && onSubmit(point)}
        className={`mt-2 min-h-[clamp(2.7rem,10vw,3.5rem)] w-full shrink-0 rounded-2xl px-5 text-sm font-black shadow-lg transition hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-40 sm:mt-3 ${game ? "bg-info-300 text-brand-950 shadow-info-300/10" : "bg-brand-950 text-on-brand"}`}
      >
        이 위치로 제출
      </button>
    </div>
  );
}

/** 이미지 위에 놓인 핀을 그립니다. 좌표가 %라 이미지가 어떤 크기로 그려져도 같은 자리에 붙습니다. */
export function PinMarker({ point, tone = "neutral", size = "md" }: { point: PinPoint; tone?: "neutral" | "correct" | "wrong"; size?: "sm" | "md" }) {
  const color = tone === "correct" ? "text-info-400" : tone === "wrong" ? "text-danger-400" : "text-info-300";
  return (
    <span
      className={`pointer-events-none absolute -translate-x-1/2 -translate-y-full drop-shadow ${color}`}
      style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
    >
      <MapPin className={size === "sm" ? "h-4 w-4" : "h-6 w-6"} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />
    </span>
  );
}

/* ----------------------------------------------------------------- 분포도 */

/**
 * 모인 핀을 이미지 위에 한꺼번에 보여 줍니다. 핀 고정형은 정답 영역과 정오답 색까지,
 * 드롭 핀(참여형)은 정답이 없어 핀만 그립니다.
 */
export function PinDistribution({ imageUrl, imageAlt, pins, areas = [], emphasizeAreas = false, fit = false, fitMaxHeightVh, className = "" }: {
  imageUrl: string;
  imageAlt: string | null;
  pins: { point: PinPoint; isCorrect?: boolean }[];
  areas?: PinArea[];
  emphasizeAreas?: boolean;
  fit?: boolean;
  fitMaxHeightVh?: number;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <PinFrame
        imageUrl={imageUrl}
        imageAlt={imageAlt}
        fit={fit}
        fitMaxHeightVh={fitMaxHeightVh}
        htmlOverlay={pins.map((pin, index) => (
          <PinMarker key={index} point={pin.point} size="sm" tone={pin.isCorrect === undefined ? "neutral" : pin.isCorrect ? "correct" : "wrong"} />
        ))}
      >
        <AreaShapes areas={areas} emphasized={emphasizeAreas} />
      </PinFrame>
    </div>
  );
}
