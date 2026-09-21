import { Prisma, type ShortLinkTargetType } from "@/generated/prisma/client";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { assertCanManageShortLink, type ShortLinkTarget } from "@/lib/short-links/access";
import {
  disableShortLink,
  findActiveShortLink,
  saveShortLink,
  ShortLinkConflictError,
} from "@/lib/short-links/service";
import { normalizeShortLinkSlug, shortLinkSlugError } from "@/lib/short-links/slug";

const targetSchema = z.object({
  targetType: z.enum(["BOARD", "QUIZ_SESSION", "FORM"]),
  targetId: z.string().trim().min(1).max(128),
});
const saveSchema = targetSchema.extend({ slug: z.string().max(80) });
const BODY_MAX_BYTES = 16 * 1024;
function parseTarget(value: unknown): ShortLinkTarget {
  return targetSchema.parse(value) as { targetType: ShortLinkTargetType; targetId: string };
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, {
    ...init,
    headers,
  });
}

export async function GET(request: Request) {
  try {
    const actor = await requireActiveUser();
    assertRateLimit(request, {
      scope: "short-link-read",
      userId: actor.id,
      windowMs: 60_000,
      maxAttempts: 120,
    });
    const url = new URL(request.url);
    const target = parseTarget(Object.fromEntries(url.searchParams));
    await assertCanManageShortLink(actor, target);

    const shortLink = await findActiveShortLink(target);
    return noStoreJson({ shortLink });
  } catch (error) {
    return apiError(error, "짧은 주소 정보를 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    assertRateLimit(request, {
      scope: "short-link-save",
      userId: actor.id,
      windowMs: 60_000,
      maxAttempts: 30,
    });

    const parsed = saveSchema.parse(await readJsonWithLimit(request, BODY_MAX_BYTES));
    const target = parseTarget(parsed);
    await assertCanManageShortLink(actor, target, { requireActiveTarget: true });
    const slug = normalizeShortLinkSlug(parsed.slug);
    const validationError = shortLinkSlugError(slug);
    if (validationError) return noStoreJson({ error: validationError }, { status: 400 });

    try {
      const shortLink = await saveShortLink(target, slug, actor.id);
      return noStoreJson({ shortLink });
    } catch (error) {
      if (
        error instanceof ShortLinkConflictError
        || (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
      ) {
        return noStoreJson({ error: "이미 사용 중이거나 예약된 짧은 주소입니다." }, { status: 409 });
      }
      throw error;
    }
  } catch (error) {
    return apiError(error, "짧은 주소를 저장하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    assertRateLimit(request, {
      scope: "short-link-delete",
      userId: actor.id,
      windowMs: 60_000,
      maxAttempts: 30,
    });
    const url = new URL(request.url);
    const target = parseTarget(Object.fromEntries(url.searchParams));
    await assertCanManageShortLink(actor, target);
    await disableShortLink(target);
    return noStoreJson({ ok: true });
  } catch (error) {
    return apiError(error, "짧은 주소를 삭제하지 못했습니다.");
  }
}
