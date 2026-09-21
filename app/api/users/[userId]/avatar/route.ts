import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getAvatarPath } from "@/lib/files/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 아바타 URL은 name과 같은 노출 수준으로 취급합니다: 이미 이름을 볼 수 있는 화면(공개 보드 포함)에
// 함께 내려오는 값이라 여기서 별도의 보드 멤버십 검사를 다시 하지 않습니다.
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  let filePath: string;
  try {
    filePath = getAvatarPath(userId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(fileStat.size),
      "Content-Disposition": "inline; filename=\"avatar.webp\"",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
