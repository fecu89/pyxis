"use client";

import type { ReactNode } from "react";

const commentTimeFormatter = new Intl.DateTimeFormat("ko", {
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});

/**
 * 댓글 본문·시각 표시를 상세 화면과 카드가 함께 씁니다. 같은 댓글이 두 자리에서 다르게
 * 보이면(멘션이 한쪽에서만 강조된다든지) 같은 것이라는 느낌이 깨집니다.
 */

export type CommentBodyToken =
  | { kind: "text" | "mention"; text: string }
  | { kind: "link"; text: string; href: string };

const bodyTokenPattern = /https?:\/\/[^\s<>"']+|@[\p{L}\p{N}_.-]{1,60}/giu;
const simpleTrailingPunctuation = /[.,!?;:]$/u;

function trimLinkPunctuation(candidate: string) {
  let core = candidate;
  let suffix = "";
  while (simpleTrailingPunctuation.test(core)) {
    suffix = `${core.at(-1)}${suffix}`;
    core = core.slice(0, -1);
  }
  for (const [opening, closing] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (core.endsWith(closing) && core.split(opening).length < core.split(closing).length) {
      suffix = `${closing}${suffix}`;
      core = core.slice(0, -1);
    }
  }
  return { core, suffix };
}

function safeHttpHref(candidate: string) {
  try {
    const parsed = new URL(candidate);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** 댓글은 HTML로 해석하지 않고, 멘션과 완전한 HTTP(S) 주소만 표시 토큰으로 승격합니다. */
export function tokenizeCommentBody(body: string): CommentBodyToken[] {
  const tokens: CommentBodyToken[] = [];
  let cursor = 0;
  for (const match of body.matchAll(bodyTokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ kind: "text", text: body.slice(cursor, index) });
    const value = match[0];
    if (value.startsWith("@")) {
      tokens.push({ kind: "mention", text: value });
    } else {
      const { core, suffix } = trimLinkPunctuation(value);
      const href = safeHttpHref(core);
      if (href) tokens.push({ kind: "link", text: core, href });
      else tokens.push({ kind: "text", text: core });
      if (suffix) tokens.push({ kind: "text", text: suffix });
    }
    cursor = index + value.length;
  }
  if (cursor < body.length) tokens.push({ kind: "text", text: body.slice(cursor) });
  return tokens;
}

export function renderCommentBody(body: string, mentionClassName: string, linkClassName?: string): ReactNode {
  return tokenizeCommentBody(body).map((token, index) => {
    if (token.kind === "mention") {
      return <mark className={mentionClassName} key={`${token.text}-${index}`}>{token.text}</mark>;
    }
    if (token.kind === "link") {
      return (
        <a
          className={linkClassName}
          href={token.href}
          target="_blank"
          rel="noopener noreferrer nofollow ugc"
          referrerPolicy="no-referrer"
          key={`${token.href}-${index}`}
        >
          {token.text}
        </a>
      );
    }
    return token.text;
  });
}

export function formatCommentTime(value: string) {
  return commentTimeFormatter.format(new Date(value));
}
