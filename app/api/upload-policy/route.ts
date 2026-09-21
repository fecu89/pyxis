import { getUploadPolicy } from "@/lib/files/upload-policy";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 업로드 용량 상한을 화면에 알려 줍니다.
 *
 * 파일 선택창과 작성기가 서버와 같은 숫자를 써야 "고를 수는 있는데 올리면 거절당하는" 상태가
 * 생기지 않습니다. 예전에는 클라이언트(components/pad/attachments/file-rules.ts)에 상수가 따로
 * 박혀 있어서, 관리자가 정책을 바꿔도 화면은 옛 값을 계속 안내했습니다.
 *
 * 로그인 없이도 답합니다 — 손님도 패드에 사진을 올릴 수 있고, 상한은 업로드를 한 번 시도해
 * 보면 그대로 드러나는 값이라 숨겨서 얻는 것이 없습니다. 응답에는 사용자별 정보가 없으므로
 * 공유 캐시에 잠깐 담아도 됩니다.
 */
export async function GET() {
  try {
    const policy = await getUploadPolicy();
    return Response.json(policy, {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    return apiError(error, "업로드 정책을 불러오지 못했습니다.");
  }
}
