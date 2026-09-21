import "server-only";

import {
  AnswerValidationError,
  DuplicateResponseError,
  FormFullError,
  FormLoginRequiredError,
  FormNotAcceptingError,
  FormSubmitError,
} from "@/lib/forms/submit";
import { apiError } from "@/lib/http";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" } as const;

function formError(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: PRIVATE_NO_STORE });
}

/** 공개 설문의 신규 제출과 제출 후 수정이 공유하는 오류 응답 규칙입니다. */
export function formResponseError(error: unknown) {
  if (error instanceof AnswerValidationError) {
    return formError({ error: error.message, fieldId: error.fieldId, fieldIndex: error.fieldIndex }, 400);
  }
  if (error instanceof DuplicateResponseError) {
    return formError({ error: error.message }, 409);
  }
  if (error instanceof FormFullError) {
    return formError({ error: error.message }, 409);
  }
  if (error instanceof FormNotAcceptingError) {
    return formError({ error: error.message, reason: error.reason }, 409);
  }
  if (error instanceof FormLoginRequiredError) {
    return formError({ error: error.message }, 401);
  }
  if (error instanceof FormSubmitError) {
    return formError({ error: error.message }, 400);
  }
  return apiError(error, "설문 제출을 처리하지 못했습니다.");
}
