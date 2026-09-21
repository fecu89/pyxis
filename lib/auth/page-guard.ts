import "server-only";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeInternalCallbackUrl } from "@/lib/auth/callback-url";

export { safeInternalCallbackUrl } from "@/lib/auth/callback-url";

export function loginRedirectPath(callbackUrl: string): string {
  // `/login`은 실제 페이지입니다. 예전에는 홈의 `?login=1` 모달로 보냈는데, 그러면 로그인
  // 주소를 북마크하거나 링크로 보낼 수 없고 마케팅 페이지를 한 번 거쳐야 했습니다.
  const searchParams = new URLSearchParams({ callbackUrl: safeInternalCallbackUrl(callbackUrl) });
  return "/login?" + searchParams.toString();
}

export function redirectToLogin(callbackUrl: string): never {
  redirect(loginRedirectPath(callbackUrl));
}

export async function requireAuthenticatedPage(callbackUrl: string) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin(callbackUrl);
  return user;
}
