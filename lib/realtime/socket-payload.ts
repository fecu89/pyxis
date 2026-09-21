import { z } from "zod";

const identifier = z.string().trim().min(1).max(128);

export const sessionSocketPayloadSchema = z.object({
  sessionId: identifier,
});

export const kickSocketPayloadSchema = z.object({
  sessionId: identifier,
  participantId: identifier,
});

export const answerSocketPayloadSchema = z.object({
  sessionId: identifier,
  questionId: identifier,
  choiceId: identifier.nullable().optional().default(null),
  choiceIds: z.array(identifier).max(6).optional(),
  textResponse: z.string().max(2_000).nullable().optional(),
});

export function parseSocketPayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error("요청 형식이 올바르지 않습니다.");
  return parsed.data;
}
