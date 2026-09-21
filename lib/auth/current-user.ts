import "server-only";

import { cache } from "react";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { authOptions } from "@/lib/auth/auth-options";
import { PUBLIC_GUEST_REQUEST_HEADER } from "@/lib/auth/public-guest";
import { getPrivateUserDTO, type PrivateUserDTO } from "@/lib/users/repository";

export type CurrentUser = PrivateUserDTO;

export async function getCurrentUserId(): Promise<string | null> {
  // 승인 전 계정이 로그인 없이 열리는 참여 화면을 방문한 요청은 프록시가 게스트로 표시합니다.
  // 이때 세션 쿠키 자체를 지우면 보드 비밀번호·손님 신분 같은 다른 쿠키까지 잃기 때문에,
  // 신뢰 경계에서 덮어쓴 내부 헤더로 인증 사용자만 익명화합니다.
  if ((await headers()).get(PUBLIC_GUEST_REQUEST_HEADER) === "1") return null;
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

// layout.tsx와 page.tsx가 같은 요청 안에서 각자 호출해도 실제 세션·DB 조회는 한 번만 일어나도록
// React cache()로 감쌉니다(app/(dashboard)/layout.tsx + 그 아래 page.tsx가 대표적인 소비처).
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const user = await getPrivateUserDTO(userId);
  return user?.status === "ACTIVE" ? user : null;
});

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  return user;
}

export class AuthenticationError extends Error {
  constructor() {
    super("로그인이 필요합니다.");
    this.name = "AuthenticationError";
  }
}
