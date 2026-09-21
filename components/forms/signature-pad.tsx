"use client";

import { useEffect, useRef, useState } from "react";
import SmoothSignaturePad, { type PointGroup } from "signature_pad";
import { Eraser, Undo2 } from "lucide-react";
import {
  hasSignature,
  signaturePadDataToStrokes,
  signatureStrokesToPadPoints,
  type SignatureStrokes,
} from "@/lib/forms/signature";

// signature_pad가 입력 보간과 펜/터치 이벤트를 맡고, 저장 경계에서만 0~1 좌표 JSON으로 바꿉니다.
// 캔버스 픽셀이나 Data URL을 저장하지 않으므로 DPR·화면 크기가 달라도 같은 서명을 복원할 수 있습니다.

export function SignaturePad({ value, onChange, disabled = false, ariaLabel = "서명" }: {
  value: SignatureStrokes;
  onChange: (strokes: SignatureStrokes) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SmoothSignaturePad | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const drawingRef = useRef(false);
  const redrawRef = useRef<(strokes: SignatureStrokes) => void>(() => undefined);
  const [hasInk, setHasInk] = useState(() => hasSignature(value));

  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => { valueRef.current = value; });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const penColor = getComputedStyle(canvas).color;
    const pad = new SmoothSignaturePad(canvas, {
      minWidth: 0.7,
      maxWidth: 2.6,
      minDistance: 2,
      throttle: 8,
      penColor,
      backgroundColor: "rgba(0,0,0,0)",
    });
    padRef.current = pad;

    const redraw = (strokes: SignatureStrokes) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      pad.clear();
      if (!width || !height || !strokes.length) return;
      const groups = signatureStrokesToPadPoints(strokes, width, height).map((group) => ({
        dotSize: 0,
        minWidth: 0.7,
        maxWidth: 2.6,
        penColor,
        velocityFilterWeight: 0.7,
        compositeOperation: "source-over" as GlobalCompositeOperation,
        points: group.points,
      })) satisfies PointGroup[];
      pad.fromData(groups);
    };
    redrawRef.current = redraw;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const width = Math.round(rect.width * ratio);
      const height = Math.round(rect.height * ratio);
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")?.scale(ratio, ratio);
      redraw(valueRef.current);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const beginStroke = () => {
      drawingRef.current = true;
      setHasInk(true);
    };
    const endStroke = () => {
      drawingRef.current = false;
      const strokes = signaturePadDataToStrokes(pad.toData(), canvas.clientWidth, canvas.clientHeight);
      valueRef.current = strokes;
      setHasInk(strokes.length > 0);
      onChangeRef.current(strokes);
    };
    pad.addEventListener("beginStroke", beginStroke);
    pad.addEventListener("endStroke", endStroke);
    if (disabled) pad.off();

    return () => {
      observer.disconnect();
      pad.removeEventListener("beginStroke", beginStroke);
      pad.removeEventListener("endStroke", endStroke);
      pad.off();
      padRef.current = null;
      redrawRef.current = () => undefined;
    };
  }, [disabled]);

  useEffect(() => {
    if (drawingRef.current) return;
    redrawRef.current(value);
    setHasInk(hasSignature(value));
  }, [value]);

  function commitPad() {
    const canvas = canvasRef.current;
    const pad = padRef.current;
    if (!canvas || !pad) return;
    const strokes = signaturePadDataToStrokes(pad.toData(), canvas.clientWidth, canvas.clientHeight);
    valueRef.current = strokes;
    setHasInk(strokes.length > 0);
    onChangeRef.current(strokes);
  }

  function undo() {
    const pad = padRef.current;
    if (!pad) return;
    const groups = pad.toData();
    groups.pop();
    pad.fromData(groups);
    commitPad();
  }

  function clear() {
    padRef.current?.clear();
    valueRef.current = [];
    setHasInk(false);
    onChangeRef.current([]);
  }

  return (
    <div className="space-y-2">
      <div className={`relative h-44 w-full overflow-hidden rounded-lg border bg-surface ${disabled ? "border-line opacity-60" : "border-line hover:border-brand-300"}`}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={hasInk ? ariaLabel : `${ariaLabel} (비어 있음)`}
          className={`absolute inset-0 h-full w-full touch-none text-content ${disabled ? "cursor-default" : "cursor-crosshair"}`}
        />
        <span className="pointer-events-none absolute inset-x-5 bottom-8 border-b border-content-subtle/35" aria-hidden />
        {!hasInk && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-xs font-bold text-content-subtle">
            서명
          </span>
        )}
      </div>
      {!disabled && (
        <div className="flex items-center justify-end gap-1">
          <button type="button" disabled={!hasInk} onClick={undo} aria-label="마지막 획 취소" title="마지막 획 취소" className="grid h-9 w-9 place-items-center rounded-lg text-content-muted transition hover:bg-surface-hover disabled:opacity-35">
            <Undo2 className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" disabled={!hasInk} onClick={clear} aria-label="서명 지우기" title="서명 지우기" className="grid h-9 w-9 place-items-center rounded-lg text-content-muted transition hover:bg-surface-hover disabled:opacity-35">
            <Eraser className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
