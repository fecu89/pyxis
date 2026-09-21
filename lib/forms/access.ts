import "server-only";

import { randomBytes } from "node:crypto";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { resolveFormAccessLevel } from "@/lib/forms/access-level";

// 설문의 접근 권한. lib/quiz/access.ts와 같은 사다리(OWNER > EDITOR > VIEWER)입니다.
//
// 다른 점 하나 — 퀴즈에는 "검색 공개"가 있어 남의 퀴즈도 열람·복제할 수 있지만, 설문은 응답에
// 개인정보가 담기므로 그런 통로를 두지 않았습니다. 설문을 볼 수 있는 사람은 소유자, 공유받은
// 사람, 그리고 콘텐츠 관리 권한을 가진 관리자뿐입니다.

export type { FormAccessLevel } from "@/lib/forms/access-level";

export async function getFormAccess(formId: string, actor: CurrentUser) {
  const form = await getPrisma().form.findUnique({
    where: { id: formId },
    include: { shares: { where: { userId: actor.id }, select: { permission: true } } },
  });
  if (!form || form.deletedAt) return null;

  const level = resolveFormAccessLevel(form, actor);
  if (!level) return null;

  return { form, level };
}

export async function requireViewableForm(formId: string, actor: CurrentUser) {
  const access = await getFormAccess(formId, actor);
  if (!access) throw new AuthorizationError("설문을 찾을 수 없거나 볼 권한이 없습니다.");
  return access;
}

export async function requireManageableForm(formId: string, actor: CurrentUser) {
  const access = await requireViewableForm(formId, actor);
  if (access.level === "VIEWER") throw new AuthorizationError("이 설문은 보기 권한만 있습니다.");
  return access.form;
}

export async function requireOwnedForm(formId: string, actor: CurrentUser) {
  const access = await requireViewableForm(formId, actor);
  if (access.level !== "OWNER") throw new AuthorizationError("설문 소유자만 이 작업을 할 수 있습니다.");
  return access.form;
}

// ── 공개 주소 ─────────────────────────────────────────────────────────────────

/**
 * 공개 응답 주소 `/s/{slug}`에 쓰는 값입니다.
 *
 * 제목에서 만들지 않고 무작위로 뽑습니다 — 한글 제목은 슬러그가 되지 않아 어차피 음차나
 * 인코딩이 필요하고, 무엇보다 제목을 넣으면 "3학년 2반 상담 신청" 같은 주소가 링크를 받은
 * 사람 모두에게 내용을 알려 줍니다. 설문 링크는 단톡방에 그대로 붙습니다.
 *
 * base32 계열 문자만 써서 손으로 옮겨 적을 때 0/O, 1/l이 헷갈리지 않게 합니다.
 */
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const FORM_SLUG_LENGTH = 10;

export function createFormSlug(): string {
  const bytes = randomBytes(FORM_SLUG_LENGTH);
  let slug = "";
  for (const byte of bytes) slug += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
  return slug;
}

// ── 응답 가능 여부 ────────────────────────────────────────────────────────────
// `FormClosedReason`·`FORM_CLOSED_MESSAGES`·`formClosedReason()`은 `lib/forms/field-types.ts`로
// 옮겼습니다 — 응답 화면(클라이언트 컴포넌트)도 읽어야 하는데 이 파일은 `server-only`입니다.

/**
 * 발행할 때 예약된 마감 시각을 지울지. **이미 지난 마감만 지웁니다.**
 *
 * 처음 발행하는 경우(DRAFT → OPEN)와 다시 여는 경우(CLOSED → OPEN)를 상태만으로는 구분하지
 * 않습니다 — 대신 closeAt이 미래인지만 봅니다. 무조건 지우면 설정에서 미리 정한 마감 예약이
 * 첫 발행에서 사라지고, 무조건 안 지우면 지난 마감으로 닫혔던 설문을 다시 열어도 곧바로
 * `formClosedReason`이 PAST_DUE로 되돌려서 재개가 안 됩니다.
 */
export function shouldClearCloseAt(closeAt: Date | null, now = new Date()): boolean {
  return closeAt !== null && closeAt <= now;
}
