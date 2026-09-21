import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import {
  pendingAttachmentBlock,
  postContentSegments,
  referencedAttachmentIds,
  removeStoredAttachmentBlock,
  replacePendingAttachmentReferences,
  storedAttachmentBlock,
  stripPendingAttachmentBlocks,
} from "../components/pad/post-content-blocks";
import type { AttachmentViewData } from "../components/pad/attachments/types";
import { remarkRelaxedStrong } from "../components/pad/remark-relaxed-strong";

function image(id: string, originalName: string): AttachmentViewData {
  return {
    id,
    type: "IMAGE",
    originalName,
    mimeType: "image/webp",
    fileSize: 100,
    width: 800,
    height: 600,
  };
}

const first = image("image-1", "첫 사진 [수업].webp");
const second = image("image-2", "두 번째 사진.webp");
const body = [
  "# 관찰 결과",
  "",
  "첫 문단입니다.",
  "",
  storedAttachmentBlock(first),
  "",
  "사진 사이 설명입니다.",
  "",
  storedAttachmentBlock(second),
].join("\n");

assert.deepEqual(
  postContentSegments(body, [first, second]).map((segment) => segment.kind === "attachment" ? segment.attachmentId : segment.body.trim()),
  ["# 관찰 결과\n\n첫 문단입니다.", "image-1", "사진 사이 설명입니다.", "image-2"],
  "Markdown과 여러 첨부의 상대 순서를 보존해야 합니다.",
);
assert.deepEqual([...referencedAttachmentIds(body)], ["image-1", "image-2"]);
assert.match(body, /pyxis-attachment\/image-1/, "새 첨부 표식은 Milkdown이 보존하는 상대 경로여야 합니다.");
const withoutFirst = removeStoredAttachmentBlock(body, first.id);
assert.doesNotMatch(withoutFirst, /pyxis-attachment\/image-1/, "삭제한 첨부의 본문 표식도 제거해야 합니다.");
assert.match(withoutFirst, /첫 문단입니다/);
assert.match(withoutFirst, /pyxis-attachment\/image-2/, "다른 첨부 표식은 보존해야 합니다.");

const pending = [
  "업로드 전 본문",
  "",
  pendingAttachmentBlock({ kind: "upload", id: "client-1" }, "새 사진.webp", "IMAGE"),
  "",
  pendingAttachmentBlock({ kind: "upload", id: "client-failed" }, "실패 사진.webp", "IMAGE"),
].join("\n");
const resolved = replacePendingAttachmentReferences(pending, new Map([["upload:client-1", "stored-1"]]));
assert.match(resolved, /pyxis-attachment\/stored-1/);
assert.doesNotMatch(stripPendingAttachmentBlocks(resolved), /pyxis-upload:|실패 사진/);
assert.match(stripPendingAttachmentBlocks(resolved), /pyxis-attachment\/stored-1/);
assert.deepEqual(
  postContentSegments(pending, []).map((segment) => segment.kind === "markdown" ? segment.body.trim() : segment.attachmentId),
  ["업로드 전 본문"],
  "업로드 중인 임시 첨부 표식은 게시 화면에 노출하지 않아야 합니다.",
);

const angleWrapped = body.replace("pyxis-attachment/image-1", "<pyxis-attachment/image-1>");
assert.deepEqual([...referencedAttachmentIds(angleWrapped)], ["image-1", "image-2"]);

const legacyBody = body.replaceAll("pyxis-attachment/", "pyxis-attachment:");
assert.deepEqual([...referencedAttachmentIds(legacyBody)], ["image-1", "image-2"], "이전 프로토콜 표식도 읽어야 합니다.");
assert.doesNotMatch(removeStoredAttachmentBlock(legacyBody, first.id), /pyxis-attachment:image-1/, "이전 형식의 삭제 표식도 제거해야 합니다.");

const relaxedStrong = renderToStaticMarkup(createElement(ReactMarkdown, {
  remarkPlugins: [remarkRelaxedStrong],
}, "이메일은 OOO**@korea.kr** 로 입력하고 **일반 강조**도 유지합니다."));
assert.match(relaxedStrong, /OOO<strong>@korea\.kr<\/strong>/, "편집기가 허용한 문장부호 시작 강조를 게시 화면도 렌더링해야 합니다.");
assert.match(relaxedStrong, /<strong>일반 강조<\/strong>/, "표준 CommonMark 강조도 그대로 렌더링해야 합니다.");

console.log("post_content_block_checks=passed");
