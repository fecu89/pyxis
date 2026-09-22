import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { PUBLIC_GUEST_REQUEST_HEADER } from "@/lib/auth/public-guest";
import { DASHBOARD_PATH, isMarketingPath, isOpenApiPath, isPlayPath, PUBLIC_HOME_PATH } from "@/lib/routes";
import { ADMIN_SECTION_PATHS, legacyAdminSection } from "@/lib/admin/navigation";
import { FORM_LIST_PATHS, legacyFormListView } from "@/lib/forms/navigation";
import { QUIZ_LIBRARY_PATHS, legacyQuizLibraryView } from "@/lib/quiz/library-navigation";
import { REPORT_ACTIVITY_PATHS, legacyReportActivityType } from "@/lib/activity/report-navigation";
import { createRateLimiter } from "@/lib/security/rate-limit-core";
import { rateLimitIdentity } from "@/lib/security/request-identity";

const ONBOARDING_PATH = "/onboarding";
const APPROVAL_PENDING_PATH = "/approval-pending";
const PASSWORD_CHANGE_PATH = "/change-password";

// 모든 쓰기 API의 공통 백스톱입니다. 라우트별 좁은 제한(lib/security/rate-limit.ts의
// assertRateLimit)과 별개로, 어떤 경로든 한 계정이 분당 이 횟수를 넘겨 쓰지 못하게 막습니다.
// 정상 사용(설정 자동저장·드래그 정렬·반응 연타·첨부 업로드)의 최대치보다 넉넉하게 잡아
// 사람의 조작은 절대 걸리지 않고 스크립트 남용만 걸리는 값입니다.
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const writeLimiter = createRateLimiter({ windowMs: 60_000, maxAttempts: 200 });

// 이 프로젝트는 별도 리버스 프록시 쪽 보안 헤더 설정이 없어서, XSS·클릭재킹 방어의 마지막
// 방어선인 응답 헤더가 여기서 정해집니다(전체관리자 게시물·댓글이 저장형 XSS의 표적이 될 수
// 있는 서비스 특성상, react-markdown/rehype-sanitize와 파일 업로드 검증만으로 끝내지 않습니다).
//
// script-src는 'unsafe-inline' 대신 요청마다 새로 만드는 nonce를 씁니다. Next.js는 요청 헤더의
// Content-Security-Policy에서 nonce를 읽어 자기가 주입하는 인라인 부트스트랩·플라이트 스크립트에
// 자동으로 붙입니다. 앱에서 직접 렌더링하는 인라인 스크립트는 두지 않습니다. 브라우저가 nonce
// 속성값을 숨길 때 React hydration 비교가 어긋날 수 있기 때문입니다. 테마는 서버 쿠키 렌더링으로
// 처리합니다. 'unsafe-inline'을 뒤에 남겨두는 건 nonce를 이해하지 못하는 아주 오래된
// 브라우저용 폴백입니다 — nonce가 있으면 최신 브라우저는 'unsafe-inline'을 무시합니다.
// img-src는 링크 미리보기 썸네일이 임의의 외부 호스트에서 올 수 있어 https: 전체를 허용합니다
// (img 태그는 스크립트를 실행하지 않으므로 XSS 위험은 없음). 개발 모드는 Next의 webpack
// eval 기반 소스맵·HMR이 'unsafe-eval' 없이는 콘솔 에러를 내므로 프로덕션에서만 뺍니다.
// 퀴즈 실시간 계층(Socket.IO)은 폴링(HTTP)으로 시작해 WebSocket으로 업그레이드합니다.
// `connect-src 'self'`는 브라우저마다 ws:/wss:로 해석되지 않아(w3c/webappsec-csp#7, MDN 경고)
// 업그레이드만 막히는데, 그러면 Socket.IO는 조용히 롱폴링으로 되돌아갑니다 — 기능은 살아 있고
// 지연과 서버 부하만 늘어서 알아채기 어렵습니다. 그렇다고 `ws: wss:`처럼 스킴 전체를 열면
// 임의 호스트로의 유출 채널이 되므로, CSRF 검사에 이미 쓰는 APP_ORIGINS에서 호스트만 뽑습니다.
const SOCKET_ORIGINS = (process.env.APP_ORIGINS ?? process.env.NEXT_PUBLIC_URL ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .flatMap((value) => {
    try {
      const { host } = new URL(value);
      return [`ws://${host}`, `wss://${host}`];
    } catch {
      return [];
    }
  })
  .join(" ");

function contentSecurityPolicy(nonce: string, isDev: boolean) {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval'은 WebAssembly 컴파일만 허용하고 eval·new Function은 그대로 막습니다
    // ('unsafe-eval'과 다릅니다). PDF 뷰어(pdf.js의 JBIG2·JPEG2000·색 프로파일 디코더)와
    // 한글 문서 뷰어(@rhwp/core, Rust+WASM)가 이게 없으면 브라우저에서 컴파일 단계에서 막힙니다.
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' 'wasm-unsafe-eval' https://static.cloudflareinsights.com${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${SOCKET_ORIGINS ? ` ${SOCKET_ORIGINS}` : ""}`,
    // 워커를 명시합니다. 빠뜨리면 default-src로 떨어지는데, 그 폴백 해석이 브라우저마다 달라
    // pdf.js 워커가 어떤 환경에서만 막히는 일이 생깁니다. blob:은 쓰지 않습니다.
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

type RequestContext = { nonce: string; csp: string };

function applySecurityHeaders(response: NextResponse, context: RequestContext) {
  response.headers.set("Content-Security-Policy", context.csp);
  return response;
}

// NextResponse.next()는 요청 헤더를 다시 넘겨야 Next.js가 nonce를 인식합니다.
function passThrough(request: NextRequest, context: RequestContext, options: { publicGuest?: boolean } = {}) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", context.csp);
  // 클라이언트가 내부 헤더를 위조할 수 없도록 모든 통과 요청에서 먼저 제거한 뒤, 프록시가
  // 승인 대기 공개 요청으로 판정한 경우에만 다시 붙입니다.
  requestHeaders.delete(PUBLIC_GUEST_REQUEST_HEADER);
  if (options.publicGuest) requestHeaders.set(PUBLIC_GUEST_REQUEST_HEADER, "1");
  return applySecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }), context);
}

function redirect(url: URL, context: RequestContext) {
  return applySecurityHeaders(NextResponse.redirect(url), context);
}

function redirectWithoutLegacySearch(
  request: NextRequest,
  pathname: string,
  removedKeys: ReadonlySet<string>,
  context: RequestContext,
) {
  const destination = new URL(pathname, request.url);
  for (const [key, value] of request.nextUrl.searchParams) {
    if (!removedKeys.has(key)) destination.searchParams.append(key, value);
  }
  return redirect(destination, context);
}

function json(body: unknown, init: ResponseInit, context: RequestContext) {
  return applySecurityHeaders(NextResponse.json(body, init), context);
}

function isSharedOnboardingApi(pathname: string) {
  return pathname === "/api/me/avatar"
    || pathname === "/api/me/nickname-availability"
    || pathname.startsWith("/api/auth/")
    || /^\/api\/users\/[a-z0-9-]+\/avatar$/i.test(pathname);
}

function hasPlayReferrer(request: NextRequest) {
  const value = request.headers.get("referer");
  if (!value) return false;
  try {
    const referrer = new URL(value);
    // 리버스 프록시·개발 바인딩에서는 브라우저가 보는 호스트와 request.nextUrl.origin이 다를 수
    // 있습니다. 이 신호는 권한을 주지 않고 게스트로 낮추기만 하므로 공개 경로 여부만 봅니다.
    return isPlayPath(referrer.pathname);
  } catch {
    return false;
  }
}

function hasAuthSessionCookie(request: NextRequest) {
  return request.cookies.getAll().some(({ name }) =>
    name === "next-auth.session-token"
    || name.startsWith("next-auth.session-token.")
    || name === "__Secure-next-auth.session-token"
    || name.startsWith("__Secure-next-auth.session-token."));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const nonce = createNonce();
  const context: RequestContext = {
    nonce,
    csp: contentSecurityPolicy(nonce, process.env.NODE_ENV !== "production"),
  };

  // 세션 쿠키가 없는 게스트 전용 API는 요청마다 JWE를 확인하는 비용을 아끼려고 토큰 조회 전에
  // 빠져나갑니다. 세션이 있으면 승인 대기 계정을 게스트로 낮춰야 하므로 상태를 확인합니다.
  const openApiPath = isOpenApiPath(pathname);
  if (openApiPath && !hasAuthSessionCookie(request)) return passThrough(request, context);

  const token = await getToken({ req: request, secret: process.env.AUTH_SECRET });
  const userId = typeof token?.userId === "string" ? token.userId : null;

  // 인증 경로는 자체 DB 기반 제한(lib/auth/security.ts)이 이미 훨씬 촘촘하게 걸려 있으므로
  // 여기서 두 번 세지 않습니다. 그 외 모든 쓰기 API에 계정(또는 신뢰 가능한 IP) 단위 상한을 겁니다.
  if (WRITE_METHODS.has(request.method) && pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/")) {
    const identity = rateLimitIdentity(request.headers, userId);
    if (identity) {
      const decision = writeLimiter.check(identity);
      if (!decision.allowed) {
        return json(
          { error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요." },
          { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": String(decision.retryAfterSeconds) } },
          context,
        );
      }
    }
  }

  // 로그인하지 않은 사용자는 `play` 구역(패드 본문·복제·초대·첨부)을 바로 엽니다. 승인 대기
  // 계정은 아래에서 상태를 확인한 뒤 게스트로 낮춰 같은 구역과 그 화면의 API를 사용합니다.
  if (isPlayPath(pathname) && userId === null) return passThrough(request, context);

  const state = token?.onboardingState
    ?? (token?.onboardingCompleted === false ? "PROFILE" : "COMPLETE");
  const onboardingIncomplete = userId !== null && state !== "COMPLETE";
  const passwordChangeRequired = userId !== null && token?.passwordChangeRequired === true;
  const accountApprovalBlocked = state === "ACCOUNT_PENDING" || state === "ACCOUNT_REJECTED";

  // 공개 API는 강제 비밀번호 변경·온보딩보다 먼저 통과시키되, 승인 전 계정만 익명 참여자로
  // 낮춥니다. 승인된 로그인 사용자의 공개 설문 응답 등은 기존처럼 계정에 연결됩니다.
  if (openApiPath) return passThrough(request, context, { publicGuest: accountApprovalBlocked });
  // Legal notices must remain readable before profile completion or a forced password change.
  if (pathname === "/terms" || pathname === "/privacy") return passThrough(request, context);

  if (pathname === PASSWORD_CHANGE_PATH) {
    if (!userId) {
      const loginUrl = new URL(PUBLIC_HOME_PATH, request.url);
      loginUrl.searchParams.set("login", "1");
      loginUrl.searchParams.set("callbackUrl", PASSWORD_CHANGE_PATH);
      return redirect(loginUrl, context);
    }
    if (!passwordChangeRequired) return redirect(new URL(DASHBOARD_PATH, request.url), context);
    return passThrough(request, context);
  }

  if (passwordChangeRequired) {
    if (pathname.startsWith("/api/auth/") || pathname === "/api/me/password") return passThrough(request, context);
    if (pathname.startsWith("/api/")) {
      return json(
        { error: "새 비밀번호를 먼저 설정해 주세요.", passwordChangeRequired: true },
        { status: 428 },
        context,
      );
    }
    const passwordUrl = new URL(PASSWORD_CHANGE_PATH, request.url);
    passwordUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return redirect(passwordUrl, context);
  }

  // 계정 승인은 작업공간 권한을 부여하는 경계이지, 원래 로그인이 필요 없는 페이지를 닫는
  // 경계가 아닙니다. 공개 화면에서는 승인 대기·반려 세션을 게스트로 낮춥니다. 공개 참여 화면이
  // 호출한 API도 같은 헤더를 이어 받아 Route Handler의 기존 게스트 권한 검사를 그대로 탑니다.
  if (accountApprovalBlocked && (isMarketingPath(pathname) || isPlayPath(pathname))) {
    return passThrough(request, context, { publicGuest: true });
  }
  if (accountApprovalBlocked && pathname.startsWith("/api/") && hasPlayReferrer(request)) {
    return passThrough(request, context, { publicGuest: true });
  }

  if (pathname === ONBOARDING_PATH) {
    if (!userId) {
      const loginUrl = new URL(PUBLIC_HOME_PATH, request.url);
      loginUrl.searchParams.set("login", "1");
      loginUrl.searchParams.set("callbackUrl", ONBOARDING_PATH);
      return redirect(loginUrl, context);
    }
    if (!onboardingIncomplete) return redirect(new URL(DASHBOARD_PATH, request.url), context);
    if (state === "TEACHER_PENDING" || state === "ACCOUNT_PENDING" || state === "ACCOUNT_REJECTED") {
      const pendingUrl = new URL(APPROVAL_PENDING_PATH, request.url);
      pendingUrl.search = request.nextUrl.search;
      return redirect(pendingUrl, context);
    }
    return passThrough(request, context);
  }

  if (pathname === APPROVAL_PENDING_PATH) {
    if (!userId) {
      const loginUrl = new URL(PUBLIC_HOME_PATH, request.url);
      loginUrl.searchParams.set("login", "1");
      loginUrl.searchParams.set("callbackUrl", APPROVAL_PENDING_PATH);
      return redirect(loginUrl, context);
    }
    if (!onboardingIncomplete) return redirect(new URL(DASHBOARD_PATH, request.url), context);
    if (state !== "TEACHER_PENDING" && state !== "ACCOUNT_PENDING" && state !== "ACCOUNT_REJECTED") {
      const onboardingUrl = new URL(ONBOARDING_PATH, request.url);
      onboardingUrl.search = request.nextUrl.search;
      return redirect(onboardingUrl, context);
    }
    return passThrough(request, context);
  }

  // `/admin`은 실제 화면이 아니라 예전 진입 주소입니다. layout/page 렌더를 시작한 뒤 redirect하면
  // 공통 셸이 먼저 스트리밍되어 HTTP 200 + RSC 내부 이동이 되므로, 렌더 전에 정식 하위 경로로
  // 보냅니다. `?tab=` 북마크도 여기서 한 번에 호환합니다.
  if (pathname === "/admin") {
    const section = legacyAdminSection(request.nextUrl.searchParams.get("tab"));
    return redirect(new URL(section ? ADMIN_SECTION_PATHS[section] : ADMIN_SECTION_PATHS.dashboard, request.url), context);
  }
  if (pathname === "/quiz") {
    if (request.nextUrl.searchParams.get("tab") === "discover") {
      return redirectWithoutLegacySearch(request, "/quiz/discover", new Set(["tab", "view"]), context);
    }
    const legacyView = legacyQuizLibraryView(request.nextUrl.searchParams.get("view"));
    if (legacyView) {
      return redirectWithoutLegacySearch(request, QUIZ_LIBRARY_PATHS[legacyView], new Set(["view"]), context);
    }
  }
  if (pathname === "/forms") {
    const legacyView = legacyFormListView(request.nextUrl.searchParams.get("view"));
    if (legacyView) {
      return redirectWithoutLegacySearch(request, FORM_LIST_PATHS[legacyView], new Set(["view"]), context);
    }
  }
  if (pathname === "/report") {
    const legacyType = legacyReportActivityType(request.nextUrl.searchParams.get("type"));
    if (legacyType) {
      return redirectWithoutLegacySearch(request, REPORT_ACTIVITY_PATHS[legacyType], new Set(["type"]), context);
    }
  }

  if (!onboardingIncomplete || pathname === PUBLIC_HOME_PATH) return passThrough(request, context);
  if (isSharedOnboardingApi(pathname)) return passThrough(request, context);
  if (state === "PROFILE" && pathname === "/api/onboarding") return passThrough(request, context);
  if (pathname.startsWith("/api/")) {
    return json(
      {
        error: state === "TEACHER_PENDING"
          ? "교사 가입 승인 후 이용할 수 있습니다."
          : state === "ACCOUNT_REJECTED"
            ? "가입 요청이 반려되었습니다. 승인 대기 화면에서 사유를 확인해 주세요."
            : state === "ACCOUNT_PENDING"
              ? "관리자의 가입 승인 후 이용할 수 있습니다."
              : "가입 정보를 먼저 완료해 주세요.",
        onboardingRequired: true,
        teacherApprovalPending: state === "TEACHER_PENDING",
        accountApprovalPending: state === "ACCOUNT_PENDING",
        accountApprovalRejected: state === "ACCOUNT_REJECTED",
      },
      { status: 428 },
      context,
    );
  }
  const destinationUrl = new URL(
    state === "TEACHER_PENDING" || state === "ACCOUNT_PENDING" || state === "ACCOUNT_REJECTED"
      ? APPROVAL_PENDING_PATH
      : ONBOARDING_PATH,
    request.url,
  );
  destinationUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return redirect(destinationUrl, context);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon/|icon.png|apple-icon.png|manifest.webmanifest|logo.svg).*)",
  ],
};
