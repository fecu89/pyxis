import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getPrisma } from "@/lib/prisma";
import { parseQuizImageUrl, quizImageContentType, statQuizImage } from "@/lib/quiz/image-store";
import { getSessionShare } from "@/utils/seo/sessionShare";

// 퀴즈 썸네일은 이제 파일로 저장되고 DB 컬럼에는 주소만 들어 있습니다. 그 주소
// (/api/quiz/quizzes/…/images/…)는 로그인·참여 자격을 보는 비공개 경로라 크롤러가 못 읽습니다.
// og:image는 아무 인증 없이 열려야 하므로, "공개 세션의 썸네일은 공개"라는 정책을 가진 이
// 라우트가 파일을 직접 읽어 내보냅니다. 공개 세션이 아니면 기본 공유 이미지로 넘깁니다.
//
// 옮기기 전에 만들어진 data:image/...;base64 값도 아직 남아 있을 수 있어 함께 처리합니다
// (scripts/backfill-quiz-images.ts를 돌리면 사라집니다).
const DATA_URL_PATTERN = /^data:(image\/(?:png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=]+)$/i;

// 주소에 내용 지문(version)이 들어 있어 썸네일이 바뀌면 주소도 바뀝니다. 그래서 오래 캐시해도
// 안전하고, 메신저·크롤러가 미리보기를 재요청할 때 디스크를 다시 읽지 않습니다.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pin: string; version: string }> },
) {
  const { pin } = await params;
  const share = await getSessionShare(pin);
  const fallback = () =>
    Response.redirect(new URL("/opengraph-image", process.env.NEXT_PUBLIC_URL || "http://localhost:3002"), 307);

  // 로그인 필요·종료된 세션의 썸네일은 내보내지 않습니다.
  if (share.kind !== "PUBLIC" || !share.hasThumbnail) return fallback();

  const session = await getPrisma().quizSession.findUnique({
    where: { id: share.sessionId },
    select: { quiz: { select: { id: true, thumbnailUrl: true } } },
  });
  const thumbnailUrl = session?.quiz.thumbnailUrl ?? null;

  const stored = parseQuizImageUrl(thumbnailUrl);
  if (stored) {
    if (stored.quizId !== session?.quiz.id) return fallback();
    const file = await statQuizImage(stored.quizId, stored.name);
    if (!file) return fallback();
    return new Response(Readable.toWeb(createReadStream(file.filePath)) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": quizImageContentType(stored.name),
        "Content-Length": String(file.size),
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }

  const matched = thumbnailUrl?.match(DATA_URL_PATTERN);
  if (!matched) return fallback();
  const [, contentType, base64] = matched;
  const bytes = Buffer.from(base64, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
