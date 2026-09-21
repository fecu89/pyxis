import assert from "node:assert/strict";
import { maximumHtmlBytes, readHtmlHead } from "../lib/link-preview/fetch-preview";
import { getLinkCardThumbnail, getLinkSourceHost } from "../lib/link-preview/link-card";
import { parseLinkPreview } from "../lib/link-preview/parser";
import { LinkPreviewError } from "../lib/link-preview/security";
import { getYouTubeThumbnailUrl, getYouTubeVideoId } from "../lib/link-preview/youtube-url";

async function verifyHeadReader() {
  let bodyWasRead = false;
  async function* pageChunks() {
    yield Buffer.from("<html><head><meta property=\"og:title\" content=\"테스트\">");
    yield Buffer.from("</he");
    yield Buffer.from("ad>");
    bodyWasRead = true;
    yield Buffer.alloc(maximumHtmlBytes + 1, 65);
  }

  const head = await readHtmlHead(pageChunks());
  assert.match(head.toString("utf8"), /<\/head>$/);
  assert.equal(bodyWasRead, false, "</head> 뒤의 큰 본문을 읽으면 안 됩니다.");

  async function* oversizedPage() {
    yield Buffer.alloc(maximumHtmlBytes + 1, 65);
  }
  await assert.rejects(
    () => readHtmlHead(oversizedPage()),
    (error) => error instanceof LinkPreviewError && error.status === 413,
  );
}

function verifyParserInjectionDefense() {
  const finalUrl = new URL("https://example.com/article");
  const malicious = parseLinkPreview(`
    <html><head>
      <meta property="og:title" content="안전한 제목 &lt;img src=x onerror=alert(1)&gt;">
      <meta property="og:image" content="javascript:alert(1)">
      <meta property="og:url" content="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">
    </head></html>
  `, finalUrl);
  assert.equal(malicious.title, "안전한 제목");
  assert.equal(malicious.image, null, "javascript: 이미지 URL을 허용하면 안 됩니다.");
  assert.equal(malicious.url, finalUrl.toString(), "HTTP(S)가 아닌 canonical을 허용하면 안 됩니다.");
  assert.doesNotMatch(JSON.stringify(malicious), /onerror|<script/i);

  const attributeEscape = parseLinkPreview(`
    <html><head>
      <meta property="og:title" content="속성 탈출 검사">
      <meta property="og:image" content="https://images.example/thumb.jpg&quot; onerror=&quot;alert(1)">
    </head></html>
  `, finalUrl);
  assert.equal(attributeEscape.image, null, "따옴표를 섞은 속성 탈출 URL을 허용하면 안 됩니다.");
}

function verifyYouTubeUrlParsing() {
  const id = "dQw4w9WgXcQ";
  assert.equal(getYouTubeVideoId(new URL(`https://www.youtube.com/watch?v=${id}`)), id);
  assert.equal(getYouTubeVideoId(new URL(`https://youtu.be/${id}?t=3`)), id);
  assert.equal(getYouTubeVideoId(new URL(`https://www.youtube.com/shorts/${id}`)), id);
  assert.equal(getYouTubeVideoId(new URL(`https://www.youtube.com/embed/${id}`)), id);
  assert.equal(getYouTubeVideoId(new URL(`https://evil.example/watch?v=${id}`)), null);
  assert.equal(getYouTubeVideoId(new URL("https://www.youtube.com/watch?v=too-short")), null);
  assert.equal(getYouTubeThumbnailUrl(`https://youtu.be/${id}`), `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  assert.equal(getYouTubeThumbnailUrl("javascript:alert(1)"), null);
  assert.equal(getLinkSourceHost(`https://www.youtube.com/watch?v=${id}`), "youtube.com");
  assert.equal(getLinkSourceHost("https://www.example.com/article"), "example.com");
  assert.equal(getLinkSourceHost("javascript:alert(1)"), null);
  assert.deepEqual(
    getLinkCardThumbnail("https://example.com/article", "https://cdn.example.com/card.jpg"),
    { src: "https://cdn.example.com/card.jpg", isYouTube: false },
  );
  assert.equal(getLinkCardThumbnail("https://example.com/article", "javascript:alert(1)"), null);
}

async function main() {
  await verifyHeadReader();
  verifyParserInjectionDefense();
  verifyYouTubeUrlParsing();
  console.log(`link_preview_checks=passed html_limit_bytes=${maximumHtmlBytes} youtube_urls=validated injection_payloads=rejected`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "링크 미리보기 검증에 실패했습니다.");
  process.exitCode = 1;
});
