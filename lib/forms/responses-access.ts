import "server-only";

import { after } from "next/server";
import { cache } from "react";
import { recordFormVisit } from "@/lib/dashboard/visits";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { requireViewableForm } from "@/lib/forms/access";

// 응답 layout과 하위 page가 같은 요청에서 권한·설문을 각각 필요로 합니다. React cache로 묶어
// 같은 SELECT를 두 번 실행하지 않으면서도 각 페이지가 독립적으로 접근 검사를 선언하게 합니다.
export const requireFormResponsesAccess = cache(async (formId: string) => {
  const actor = await getCurrentUser();
  if (!actor) redirectToLogin(`/forms/${formId}/responses`);
  const access = await requireViewableForm(formId, actor);
  after(() => recordFormVisit(formId, actor.id));
  return access;
});
