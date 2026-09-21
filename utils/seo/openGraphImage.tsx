/* eslint-disable @next/next/no-img-element */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import type { ShareableBoardMetadata } from "@/utils/seo/boardMetadata";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/utils/seo/getMetadata";

export const OPEN_GRAPH_SIZE = { width: 1200, height: 630 };

const layoutLabel: Record<ShareableBoardMetadata["layout"], string> = {
  SECTIONS: "섹션",
  WALL: "담벼락",
  GRID: "격자",
  STREAM: "스트림",
  TIMELINE: "타임라인",
  TABLE: "표",
};

// 본문 서체는 app/layout.tsx가 가변 woff2 하나로 처리하지만, OG 이미지는 그 파일을 쓸 수
// 없습니다. next/og(satori)는 ttf·otf·woff만 파싱하고 woff2는 못 읽습니다. 그래서 굵기별
// 정적 폰트를 따로 두는데, 같은 글립을 담고도 otf(3.0MB)보다 woff(2.2MB)가 작아 woff를 씁니다.
// 두 포맷의 렌더 결과가 같은 것은 확인했습니다.
const assetsPromise = Promise.all([
  readFile(path.join(process.cwd(), "app/fonts/Pretendard-Regular.woff")),
  readFile(path.join(process.cwd(), "app/fonts/Pretendard-Bold.woff")),
  readFile(path.join(process.cwd(), "public/logo.svg"), "utf8"),
]);

function safeColor(value: string | null | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function readableInk(background: string) {
  const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(background.slice(offset, offset + 2), 16));
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 155 ? "#172019" : "#ffffff";
}

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function renderOpenGraphImage(board?: ShareableBoardMetadata) {
  const [regularFont, boldFont, logoSvg] = await assetsPromise;
  const logo = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;
  const background = safeColor(board?.backgroundColor, board ? "#eef3ea" : "#f3f1e9");
  const accent = safeColor(board?.accentColor, "#315f43");
  const ink = readableInk(background);
  const muted = ink === "#ffffff" ? "rgba(255,255,255,.76)" : "rgba(23,32,25,.68)";
  const title = board ? truncate(board.title, 64) : SITE_NAME;
  const description = board
    ? truncate(board.description || "함께 생각을 모으고 배움을 나누는 패드입니다.", 112)
    : SITE_DESCRIPTION;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "62px 70px",
          background,
          color: ink,
          fontFamily: "Pretendard",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ position: "absolute", right: -90, top: -120, width: 390, height: 390, borderRadius: 999, background: accent, opacity: 0.16 }} />
        <div style={{ position: "absolute", right: 170, bottom: -190, width: 360, height: 360, borderRadius: 999, border: `42px solid ${accent}`, opacity: 0.12 }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ width: 76, height: 76, display: "flex", borderRadius: 18, background: "#ffffff", boxShadow: "0 12px 32px rgba(18,35,25,.12)" }}>
              <img src={logo} alt="" width={76} height={76} />
            </div>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: "-0.03em" }}>{SITE_NAME}</div>
          </div>
          {board && (
            <div style={{ display: "flex", padding: "11px 18px", borderRadius: 999, background: accent, color: "#ffffff", fontSize: 22, fontWeight: 700 }}>
              {board.discoveryScope === "LINK" ? "링크 공개" : "전체 공개"}
            </div>
          )}
        </div>

        <div style={{ width: "86%", display: "flex", flexDirection: "column", gap: 21 }}>
          <div style={{ display: "flex", fontSize: board ? 64 : 78, lineHeight: 1.12, fontWeight: 700, letterSpacing: "-0.045em" }}>
            {title}
          </div>
          <div style={{ display: "flex", fontSize: 29, lineHeight: 1.5, color: muted, letterSpacing: "-0.02em" }}>
            {description}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 22, color: muted }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 12, height: 12, borderRadius: 999, background: accent }} />
            {board ? `${layoutLabel[board.layout]} 레이아웃 · 게시물 ${board.postCount.toLocaleString("ko-KR")}개` : "배움과 생각을 함께 모으는 공간"}
          </div>
          <div style={{ display: "flex" }}>{new URL(SITE_URL).host}</div>
        </div>
      </div>
    ),
    {
      ...OPEN_GRAPH_SIZE,
      fonts: [
        { name: "Pretendard", data: toArrayBuffer(regularFont), weight: 400 },
        { name: "Pretendard", data: toArrayBuffer(boldFont), weight: 700 },
      ],
    },
  );
}
