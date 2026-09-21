import { z } from "zod";
import {
  SIGNATURE_MAX_POINTS_PER_STROKE,
  SIGNATURE_MAX_STROKE_DURATION_MS,
  SIGNATURE_MAX_STROKES,
} from "@/lib/forms/signature";

// 저장·제출 경계의 Zod 스키마입니다. 브라우저에서 서명을 그리거나 읽기만 하는 화면이 Zod
// 전체를 내려받지 않도록 순수 좌표 도구(signature.ts)와 분리합니다.
const ratio = z.number().min(0).max(1);

export const signaturePointSchema = z.object({
  x: ratio,
  y: ratio,
  pressure: ratio.optional(),
  time: z.number().int().min(1).max(SIGNATURE_MAX_STROKE_DURATION_MS).optional(),
});

export const signatureStrokeSchema = z
  .array(signaturePointSchema)
  .min(1)
  .max(SIGNATURE_MAX_POINTS_PER_STROKE);

export const signatureStrokesSchema = z.array(signatureStrokeSchema).max(SIGNATURE_MAX_STROKES);
