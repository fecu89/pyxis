import { AuthenticationError } from "@/lib/auth/current-user";
import { AuthorizationError } from "@/lib/auth/authorization";
import { ImageProcessingBusyError } from "@/lib/files/processing-queue";
import { InvalidJsonBodyError, JsonBodyTooLargeError } from "@/lib/http-json";
import { RateLimitError } from "@/lib/security/rate-limit";
import { CryptoWorkBusyError } from "@/lib/security/crypto-work-queue";
import { ShortLinkResolveBusyError } from "@/lib/short-links/errors";
import { ZodError } from "zod";

// 이 이름의 생성자는 우리가 직접 던지지 않는 에러입니다 — Prisma 내부 에러(필드·제약조건 이름을
// 드러낼 수 있음)와 버그로 발생하는 런타임 에러(TypeError 등, 내부 변수·속성명을 드러낼 수 있음)는
// 라우트가 fallback 문자열로 던진 게 아니므로 메시지를 그대로 클라이언트에 보여주면 안 됩니다.
const UNSAFE_ERROR_NAMES = new Set(["TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError"]);
const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" } as const;

function errorResponse(message: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error: message }, { status, headers: { ...PRIVATE_NO_STORE, ...headers } });
}

function isSafeToExposeMessage(error: Error) {
  const name = error.constructor?.name || error.name;
  if (name.startsWith("PrismaClient")) return false;
  return !UNSAFE_ERROR_NAMES.has(name);
}

export function apiError(error: unknown, fallback: string) {
  if (error instanceof AuthenticationError) {
    return errorResponse(error.message, 401);
  }
  if (error instanceof AuthorizationError) {
    return errorResponse(error.message, 403);
  }
  if (error instanceof JsonBodyTooLargeError) {
    return errorResponse(error.message, 413);
  }
  if (error instanceof InvalidJsonBodyError || error instanceof ZodError || error instanceof SyntaxError) {
    // ZodError.message에는 경로·스키마 구조가 길게 들어갈 수 있고 request.json()의 SyntaxError는
    // 런타임 문구가 환경마다 다릅니다. 호출 라우트가 넘긴 사용자용 fallback만 노출합니다.
    return errorResponse(fallback, 400);
  }
  // 제한 초과는 서버 오류가 아니라 정상적인 거절이므로 스택을 로그로 남기지 않습니다.
  if (error instanceof RateLimitError) {
    return errorResponse(error.message, 429, { "Retry-After": String(error.retryAfterSeconds) });
  }
  // 이미지 처리 대기열이 꽉 찬 상태도 서버 버그가 아니라 일시적 과부하이므로 503으로 알립니다.
  if (error instanceof ImageProcessingBusyError) {
    return errorResponse(error.message, 503, { "Retry-After": "10" });
  }
  if (error instanceof CryptoWorkBusyError) {
    return errorResponse(error.message, 503, { "Retry-After": "5" });
  }
  if (error instanceof ShortLinkResolveBusyError) {
    return errorResponse(error.message, 503, { "Retry-After": "2" });
  }
  if (error instanceof Error && isSafeToExposeMessage(error)) {
    return errorResponse(error.message, 400);
  }

  // Prisma 오류와 프로그래밍 오류는 클라이언트 잘못이 아닙니다. 내부 메시지는 숨기되 500으로
  // 구분해야 프록시·모니터링·클라이언트가 재시도 가능한 서버 장애로 인식할 수 있습니다.
  console.error(error);
  return errorResponse(fallback, 500);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  try {
    // 자체 호스팅에서는 Next가 request.url을 내부 주소(localhost:3001)로 구성할 수 있으므로,
    // 외부에서 실제로 허용할 origin을 환경별로 명시합니다. 전체 origin을 비교해 프로토콜과
    // 포트까지 일치시키며, 클라이언트가 위조할 수 있는 전달 헤더에 의존하지 않습니다.
    const configuredOrigins = process.env.APP_ORIGINS
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value).origin);
    if (configuredOrigins?.length) {
      if (!configuredOrigins.includes(new URL(origin).origin)) {
        throw new AuthorizationError("허용되지 않은 요청 출처입니다.");
      }
      return;
    }

    // 공개 인터넷에서 X-Forwarded-Host를 그대로 믿으면 공격자가 Origin과 둘을 함께 위조할 수
    // 있습니다. Vercel이 덮어쓰는 헤더만 예외로 사용하고, 그 외 배포는 실제 요청 URL을 기준으로
    // 비교합니다. APP_ORIGINS가 없는 자체 프록시는 외부 Host를 원본 요청 URL에 보존해야 합니다.
    const forwardedHost = process.env.VERCEL === "1"
      ? request.headers.get("x-forwarded-host")?.split(",").at(-1)?.trim()
      : null;
    const host = forwardedHost || new URL(request.url).host;
    if (!host) throw new AuthorizationError("요청 출처를 확인할 수 없습니다.");
    if (new URL(origin).host !== host) throw new AuthorizationError("허용되지 않은 요청 출처입니다.");
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    throw new AuthorizationError("요청 출처를 확인할 수 없습니다.");
  }
}
