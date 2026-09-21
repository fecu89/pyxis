import "server-only";

import type { ShortLinkTargetType } from "@/generated/prisma/client";
import {
  AuthorizationError,
  canHostOrControlSession,
  canManageBoardSettings,
  getEffectiveBoardAccess,
} from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { requireManageableForm } from "@/lib/forms/access";
import { getPrisma } from "@/lib/prisma";

export type ShortLinkTarget = { targetType: ShortLinkTargetType; targetId: string };

// 별칭은 접근 권한을 새로 만들지 않습니다. 각 콘텐츠의 기존 설정/세션 관리 권한을 그대로
// 호출해 공유 UI와 API의 권한이 시간이 지나도 갈라지지 않게 합니다.
export async function assertCanManageShortLink(
  actor: CurrentUser,
  target: ShortLinkTarget,
  options: { requireActiveTarget?: boolean } = {},
) {
  if (target.targetType === "BOARD") {
    const access = await getEffectiveBoardAccess(target.targetId, actor);
    if (!access || !canManageBoardSettings(actor, access)) {
      throw new AuthorizationError("이 패드의 짧은 주소를 관리할 권한이 없습니다.");
    }
    return;
  }

  if (target.targetType === "FORM") {
    await requireManageableForm(target.targetId, actor);
    return;
  }

  const session = await getPrisma().quizSession.findUnique({
    where: { id: target.targetId },
    select: { hostId: true, status: true },
  });
  if (!session || !canHostOrControlSession(actor, session)) {
    throw new AuthorizationError("이 퀴즈 세션의 짧은 주소를 관리할 권한이 없습니다.");
  }
  if (options.requireActiveTarget && (session.status === "FINISHED" || session.status === "CANCELLED")) {
    throw new AuthorizationError("종료된 퀴즈 세션에는 짧은 주소를 설정할 수 없습니다.");
  }
}
