import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { isQuizImageName } from "@/lib/files/paths";
import { canViewQuizImage } from "@/lib/quiz/image-access";
import { quizImageContentType, statQuizImage } from "@/lib/quiz/image-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ quizId: string; name: string }> }) {
  try {
    const { quizId, name } = await params;
    // 권한 판정보다 이름 검사를 먼저 합니다. 형식이 틀린 이름은 DB를 볼 것도 없이 끝입니다.
    if (!isQuizImageName(name)) return new Response("이미지를 찾을 수 없습니다.", { status: 404 });

    // 없는 파일과 권한 없는 파일을 같은 404로 돌려줍니다. 403으로 구분해 주면 남의 퀴즈에
    // 어떤 사진이 있는지를 주소만으로 떠볼 수 있습니다.
    if (!await canViewQuizImage(request, quizId)) return new Response("이미지를 찾을 수 없습니다.", { status: 404 });

    const file = await statQuizImage(quizId, name);
    if (!file) return new Response("이미지를 찾을 수 없습니다.", { status: 404 });

    const etag = `"${name}-${file.size}"`;
    const headers = {
      "Content-Type": quizImageContentType(name),
      "Content-Length": String(file.size),
      "Content-Disposition": `inline; filename="${name}"`,
      // 브라우저가 파일 바이트는 보관해도 사용할 때마다 이 라우트로 재검증합니다. 같은 브라우저에서
      // 로그아웃하거나 공유·참여 권한을 잃은 뒤 이전 계정의 private 캐시가 그대로 열리면 안 됩니다.
      "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
      "ETag": etag,
      "Last-Modified": new Date(file.mtimeMs).toUTCString(),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    };
    if (request.headers.get("if-none-match")?.split(",").some((value) => value.trim() === etag)) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(Readable.toWeb(createReadStream(file.filePath)) as ReadableStream<Uint8Array>, {
      headers,
    });
  } catch {
    return new Response("이미지를 찾을 수 없습니다.", { status: 404 });
  }
}
