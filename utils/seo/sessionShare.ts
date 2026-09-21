import "server-only";

import { createHash } from "node:crypto";
import { cache } from "react";
import type { Metadata } from "next";
import { getPrisma } from "@/lib/prisma";
import { getMetadata, SITE_DESCRIPTION } from "@/utils/seo/getMetadata";

const SHARE_IMAGE_TEMPLATE_VERSION = 1;

/**
 * 링크 미리보기는 카카오톡·디스코드 같은 **제3자 서버가 로그인하지 않은 채로** 가져갑니다.
 * 그래서 <head>에 넣는 값은 "링크를 가진 사람 누구에게나 공개해도 되는 정보"여야 합니다.
 *
 * - PUBLIC  : 공개 세션. PIN만 있으면 누구나 참여할 수 있으므로 제목·설명·썸네일까지 보여줘도
 *             미리보기로 새로 새는 정보가 없습니다.
 * - GATED   : 로그인 필요 세션. 제목까지만 노출합니다(참여 화면이 비로그인 방문자에게도 이미
 *             제목을 보여주고 있어, 채팅방에서 링크를 구분하려면 제목이 필요합니다).
 *             설명·썸네일·문항 수처럼 퀴즈 내용을 드러내는 값은 타입에서 아예 제외해
 *             호출부가 실수로도 내보낼 수 없게 했습니다.
 * - CLOSED  : 없는 PIN이거나 종료된 세션. 아무 정보도 주지 않습니다.
 */
export type PublicSessionShare = {
  kind: "PUBLIC";
  sessionId: string;
  title: string;
  description: string | null;
  mode: "LIVE" | "ASYNC";
  questionCount: number;
  hasThumbnail: boolean;
  imageVersion: string;
};

export type GatedSessionShare = {
  kind: "GATED";
  title: string;
};

export type ClosedSessionShare = { kind: "CLOSED" };

export type SessionShare = PublicSessionShare | GatedSessionShare | ClosedSessionShare;

type ShareImageInputs = { title: string; hasThumbnail: boolean; thumbnailFingerprint: string | null };

// 같은 내용이면 같은 URL을 유지해 캐시를 재사용하고, 썸네일이나 제목이 바뀔 때만 새 URL을 발급합니다.
function createShareImageVersion(input: ShareImageInputs) {
  return createHash("sha256")
    .update(JSON.stringify([SHARE_IMAGE_TEMPLATE_VERSION, input]))
    .digest("base64url")
    .slice(0, 12);
}

export const getSessionShare = cache(async (pin: string): Promise<SessionShare> => {
  if (!/^\d{6}$/.test(pin)) return { kind: "CLOSED" };

  const session = await getPrisma().quizSession.findUnique({
    where: { pinCode: pin },
    select: {
      id: true,
      mode: true,
      status: true,
      requiresLogin: true,
      quiz: {
        select: {
          title: true,
          description: true,
          thumbnailUrl: true,
          deletedAt: true,
          _count: { select: { questions: true } },
        },
      },
    },
  });

  if (!session || session.quiz.deletedAt) return { kind: "CLOSED" };
  if (session.status === "FINISHED" || session.status === "CANCELLED") return { kind: "CLOSED" };
  if (session.requiresLogin) return { kind: "GATED", title: session.quiz.title };

  const hasThumbnail = Boolean(session.quiz.thumbnailUrl);
  return {
    kind: "PUBLIC",
    sessionId: session.id,
    title: session.quiz.title,
    description: session.quiz.description,
    mode: session.mode,
    questionCount: session.quiz._count.questions,
    hasThumbnail,
    // 썸네일 원본(데이터 URL)은 여기서 내보내지 않고 지문만 버전에 씁니다.
    imageVersion: createShareImageVersion({
      title: session.quiz.title,
      hasThumbnail,
      thumbnailFingerprint: session.quiz.thumbnailUrl
        ? createHash("sha256").update(session.quiz.thumbnailUrl).digest("base64url").slice(0, 16)
        : null,
    }),
  };
});

function modeLabel(mode: "LIVE" | "ASYNC") {
  return mode === "LIVE" ? "실시간 퀴즈" : "자율 풀이 퀴즈";
}

/**
 * PIN 참여 링크의 메타데이터.
 *
 * 어느 경우에도 색인은 막습니다(noIndex). PIN은 세션이 끝나면 회수돼 다른 퀴즈에 다시 쓰이므로,
 * 검색 결과에 남으면 엉뚱한 세션으로 연결됩니다. 미리보기는 그대로 동작합니다.
 */
export async function buildJoinPageMetadata(pin: string): Promise<Metadata> {
  const share = await getSessionShare(pin);
  const asPath = `/j/${pin}`;

  if (share.kind === "CLOSED") {
    return getMetadata({
      title: "참여할 수 없는 퀴즈",
      description: "PIN이 올바르지 않거나 이미 종료된 세션입니다.",
      asPath,
      noIndex: true,
    });
  }

  if (share.kind === "GATED") {
    return getMetadata({
      title: share.title,
      // 퀴즈 설명 대신 "무엇을 해야 하는지"만 알려 줍니다.
      description: `학생 로그인 후 참여할 수 있는 퀴즈입니다. PIN ${pin}`,
      asPath,
      ogImageAlt: `${SITE_DESCRIPTION}`,
      noIndex: true,
    });
  }

  const summary = [modeLabel(share.mode), `문항 ${share.questionCount}개`, `PIN ${pin}`].join(" · ");
  return getMetadata({
    title: share.title,
    description: share.description?.trim() || `${summary} — 닉네임만 입력하면 바로 참여할 수 있어요.`,
    asPath,
    // 썸네일이 있으면 그 이미지를, 없으면 서비스 기본 이미지를 씁니다.
    ogImage: share.hasThumbnail ? `/j/${pin}/share-image/${share.imageVersion}` : undefined,
    // 썸네일은 원본 비율을 유지하므로 크기를 선언하지 않습니다(기본 이미지만 1200×630 고정).
    ogImageAlt: `${share.title} 퀴즈 썸네일`,
    keywords: [share.title, modeLabel(share.mode)],
    noIndex: true,
  });
}
