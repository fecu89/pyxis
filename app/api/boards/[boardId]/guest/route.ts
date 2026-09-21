import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { boardAcceptsGuestPosts } from "@/lib/auth/authorization";
import { cleanGuestName, GUEST_NAME_MAX, issueGuestSession, readGuestSession } from "@/lib/board/guest-session";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { assertRateLimit } from "@/lib/security/rate-limit";

const enterSchema = z.object({ name: z.string().trim().min(1).max(GUEST_NAME_MAX) });
const GUEST_ENTER_BODY_MAX_BYTES = 16 * 1024;

async function loadBoard(boardId: string) {
  return (await getBoardMutationAccess(boardId, null))?.board ?? null;
}

/** 지금 브라우저의 손님 신분을 알려 줍니다. 이름 입력 화면을 다시 띄울지 판단하는 데 씁니다. */
export async function GET(_request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const { boardId } = await params;
    const board = await loadBoard(boardId);
    if (!board) return Response.json({ error: "패드를 찾을 수 없습니다." }, { status: 404 });
    if (!boardAcceptsGuestPosts(board)) return Response.json({ guest: null, accepted: false }, { headers: { "Cache-Control": "private, no-store" } });
    return Response.json({ guest: await readGuestSession(boardId), accepted: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "손님 정보를 불러오지 못했습니다.");
  }
}

/**
 * 손님이 이름을 적고 들어옵니다. **권한을 주는 API가 아닙니다** — 표시 이름을 기억하고
 * "같은 브라우저인가"를 판정할 식별자를 발급할 뿐이고, 글을 쓸 수 있는지는 글 작성 API가
 * 그때 보드 설정을 다시 읽어 판단합니다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const { boardId } = await params;

    // 세션 발급 자체에도 제한을 겁니다. 쿠키를 지우고 계속 새로 받는 식의 우회를 늦춥니다.
    // 학교는 수십 명이 한 공인 IP를 함께 쓰므로(NAT) 한 반이 동시에 들어오는 정도는 통과해야 합니다.
    assertRateLimit(request, {
      scope: "guest-enter",
      windowMs: 60_000,
      maxAttempts: 60,
      message: "잠시 후 다시 시도해 주세요.",
    });

    const board = await loadBoard(boardId);
    if (!board) return Response.json({ error: "패드를 찾을 수 없습니다." }, { status: 404 });
    if (!boardAcceptsGuestPosts(board)) {
      return Response.json({ error: "이 패드는 손님 글쓰기를 받지 않습니다." }, { status: 403 });
    }
    // 로그인 사용자는 손님 신분이 필요 없습니다. 계정으로 쓰면 됩니다.
    if (await getCurrentUser()) return Response.json({ error: "이미 로그인되어 있습니다." }, { status: 409 });

    const parsed = enterSchema.safeParse(await readJsonWithLimit(request, GUEST_ENTER_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: `이름은 1~${GUEST_NAME_MAX}자로 입력해 주세요.` }, { status: 400 });
    const name = cleanGuestName(parsed.data.name);
    if (!name) return Response.json({ error: "이름을 입력해 주세요." }, { status: 400 });

    return Response.json({ guest: await issueGuestSession(boardId, name) });
  } catch (error) {
    return apiError(error, "이름을 저장하지 못했습니다.");
  }
}
