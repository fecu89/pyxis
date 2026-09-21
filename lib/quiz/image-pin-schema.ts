import { z } from "zod";
import { POLYGON_MAX_POINTS } from "@/lib/quiz/image-pin";

// 편집 저장 경계에서만 쓰는 스키마입니다. 플레이·리포트의 좌표 계산 코드가 Zod를 클라이언트
// 번들로 끌고 가지 않도록 순수 도구(image-pin.ts)와 분리합니다.
const ratio = z.number().min(0).max(1);

export const pinPointSchema = z.object({ x: ratio, y: ratio });
export const pinAreaSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("RECT"), x: ratio, y: ratio, width: ratio, height: ratio }),
  z.object({ shape: z.literal("CIRCLE"), x: ratio, y: ratio, radiusX: z.number().min(0.002).max(1), radiusY: z.number().min(0.002).max(1) }),
  z.object({ shape: z.literal("POLYGON"), points: z.array(pinPointSchema).min(3).max(POLYGON_MAX_POINTS) }),
]);
export const pinAreasSchema = z.array(pinAreaSchema).max(10);
