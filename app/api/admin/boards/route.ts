import { z } from "zod";
import { AuthorizationError, hasSystemPermission, requireActiveUser } from "@/lib/auth/authorization";
import { credentialLoginIdValueSchema } from "@/lib/auth/credentials";
import { getAdminBoardPage } from "@/lib/board/queries";
import { apiError } from "@/lib/http";
import { createLoginIdentifierLookup } from "@/lib/security/pii-crypto";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식을 확인해 주세요.");

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [10, 25, 50].includes(value), "페이지 크기는 10·25·50 중 하나여야 합니다.").default(20),
  search: z.string().trim().min(1).max(100).optional(),
  includeArchived: z.coerce.boolean().default(false),
  ownerLoginId: credentialLoginIdValueSchema.optional(),
  ownerEmail: z.email().transform((value) => value.trim().normalize("NFKC").toLocaleLowerCase("en-US")).optional(),
  updatedFrom: isoDate.optional(),
  updatedTo: isoDate.optional(),
  sortBy: z.enum(["title", "updatedAt", "sections", "posts"]).default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

// 플랫폼 전체 패드를 훑어보는 관리자 센터 "전체 패드" 탭 전용 라우트입니다. 홈 대시보드의
// "내 패드"는 항상 본인 소유·참여 패드만 보여주므로(무한정 커지지 않음), "전체 보기"가
// 필요한 이 화면만 VIEW_ALL_BOARDS 권한으로 따로 열어둡니다.
//
// 소유자는 이름이 아니라 로그인 아이디·카카오 이메일 정확 검색만 지원합니다. 이름은 PII라
// nameEncrypted로 암호화 저장돼 있어 DB 레벨 부분 일치 검색이 불가능하고(사용자 관리 탭도
// 마찬가지 제약), 페이지 단위로만 가져오는 이 화면에서 이름으로 찾으려면 전체를 복호화해야
// 해서 페이지네이션 취지에 어긋납니다.
export async function GET(request: Request) {
  try {
    const actor = await requireActiveUser();
    if (!hasSystemPermission(actor, "VIEW_ALL_BOARDS")) throw new AuthorizationError();
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return Response.json({ error: "검색 조건을 확인해 주세요." }, { status: 400 });
    const { ownerLoginId, ownerEmail, updatedFrom, updatedTo, ...rest } = parsed.data;
    const ownerIdentifier = ownerLoginId ?? ownerEmail;
    const result = await getAdminBoardPage({
      ...rest,
      ownerLoginIdentifierLookup: ownerIdentifier ? createLoginIdentifierLookup(ownerIdentifier) : undefined,
      updatedFrom: updatedFrom ? new Date(`${updatedFrom}T00:00:00.000Z`) : undefined,
      updatedTo: updatedTo ? new Date(`${updatedTo}T23:59:59.999Z`) : undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "패드 목록을 불러오지 못했습니다.");
  }
}
