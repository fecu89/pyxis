"use client";

import Image from "next/image";
import { MapPin } from "lucide-react";
import { useState } from "react";
import type { PinArea, PinPoint } from "@/lib/quiz/image-pin";

function polygonPoints(points: PinPoint[]) {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");
}

function Area({ area }: { area: PinArea }) {
  const style = {
    fill: "rgba(0, 185, 193, 0.28)",
    stroke: "rgb(0, 150, 156)",
    strokeWidth: 0.7,
    vectorEffect: "non-scaling-stroke" as const,
  };
  if (area.shape === "RECT") return <rect x={area.x * 100} y={area.y * 100} width={area.width * 100} height={area.height * 100} {...style} />;
  if (area.shape === "CIRCLE") return <ellipse cx={area.x * 100} cy={area.y * 100} rx={area.radiusX * 100} ry={area.radiusY * 100} {...style} />;
  return <polygon points={polygonPoints(area.points)} {...style} />;
}

/** 결과 화면에는 편집·드래그 도구가 필요 없으므로 핀 뷰어만 별도 청크로 유지합니다. */
export function ReportPinDistribution({ imageUrl, imageAlt, pins, areas }: {
  imageUrl: string;
  imageAlt: string | null;
  pins: Array<{ point: PinPoint; isCorrect?: boolean }>;
  areas: PinArea[];
}) {
  const [aspect, setAspect] = useState(3 / 2);
  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-surface-muted" style={{ aspectRatio: aspect }}>
      <Image
        src={imageUrl}
        alt={imageAlt || "핀 응답 이미지"}
        fill
        unoptimized
        sizes="(max-width: 768px) 100vw, 720px"
        className="object-contain"
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalHeight > 0) setAspect(image.naturalWidth / image.naturalHeight);
        }}
      />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {areas.map((area, index) => <Area key={index} area={area} />)}
      </svg>
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {pins.map((pin, index) => (
          <MapPin
            key={index}
            className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-full drop-shadow ${pin.isCorrect === undefined ? "fill-info-400 text-info-800" : pin.isCorrect ? "fill-success-500 text-success-800" : "fill-danger-400 text-danger-800"}`}
            style={{ left: `${pin.point.x * 100}%`, top: `${pin.point.y * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
