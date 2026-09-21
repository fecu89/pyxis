import { z } from "zod";
import { gridInputValueSchema, MAX_FIELDS_PER_FORM, MAX_OPTIONS_PER_FIELD, TEXT_ANSWER_MAX } from "@/lib/forms/field-types";
import { signatureStrokesSchema } from "@/lib/forms/signature-schema";

// 응답 화면(form-runner.tsx)이 보내는 제출 본문의 형태입니다. `server-only`가 아닙니다 —
// 화면이 보내기 전에 같은 스키마로 한 번 훑어 명백한 오류를 미리 잡을 수 있습니다(최종 판정은
// 항상 서버의 lib/forms/validation.ts#validateAnswer가 합니다).
//
// 스냅샷 텍스트(selectedOptionTexts·rowLabel·fieldType·fieldTitle)는 **클라이언트가 보내지
// 않습니다.** 서버가 그 순간의 FormField·FormFieldOption에서 직접 채웁니다 — 응답자가 조작한
// "스냅샷"을 그대로 믿으면 실제로 고른 것과 기록이 달라질 수 있습니다.

export const answerInputSchema = z.object({
  textValue: z.string().max(TEXT_ANSWER_MAX).optional(),
  selectedOptionIds: z.array(z.string().min(1)).max(MAX_OPTIONS_PER_FIELD).optional(),
  numberValue: z.number().finite().optional(),
  // DATE 필드는 `includeTime`에 따라 "YYYY-MM-DD" 또는 "YYYY-MM-DDTHH:mm"을 받습니다. 폼의
  // openAt/closeAt과 달리 완전한 ISO를 요구하지 않습니다 — 날짜만 고르는 값에 초·타임존을
  // 강제하면 그 값을 만들 이유가 없는 필드가 대부분 거부됩니다. 형식 판정은 서버의
  // `checkShape()`가 `new Date()`로 관대하게 합니다.
  dateValue: z.string().max(40).optional(),
  timeValue: z.string().max(20).optional(),
  gridValue: gridInputValueSchema.optional(),
  signatureStrokes: signatureStrokesSchema.optional(),
  fileIds: z.array(z.string().min(1)).max(10).optional(),
});

export type AnswerInput = z.infer<typeof answerInputSchema>;

export const submitResponseSchema = z.object({
  // 익명 설문에서 이름을 물었을 때만 씁니다. 로그인 설문은 계정 이름을 따로 저장하지 않고
  // respondentId로 조회합니다.
  respondentName: z.string().trim().max(60).nullable().optional(),
  answers: z.record(z.string().min(1), answerInputSchema).superRefine((answers, context) => {
    if (Object.keys(answers).length > MAX_FIELDS_PER_FORM) {
      context.addIssue({ code: "custom", message: `답변은 최대 ${MAX_FIELDS_PER_FORM}개까지 보낼 수 있습니다.` });
    }
  }),
});

export type SubmitResponseInput = z.infer<typeof submitResponseSchema>;
