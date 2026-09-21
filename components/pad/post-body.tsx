"use client";

import { isValidElement, useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { AttachmentViewer } from "@/components/pad/attachments/attachment-viewer";
import type { AttachmentMetadataInput, AttachmentViewData } from "@/components/pad/attachments/types";
import { postContentSegments } from "@/components/pad/post-content-blocks";
import { remarkRelaxedStrong } from "@/components/pad/remark-relaxed-strong";

export function PostBody({
  body,
  attachments = [],
  canDownload = true,
  canEditAttachments = false,
  compact = false,
  onDeleteAttachment,
  onUpdateAttachmentMetadata,
}: {
  body: string;
  attachments?: AttachmentViewData[];
  canDownload?: boolean;
  canEditAttachments?: boolean;
  compact?: boolean;
  onDeleteAttachment?: (attachment: AttachmentViewData) => void;
  onUpdateAttachmentMetadata?: (attachmentId: string, value: AttachmentMetadataInput) => Promise<void>;
}) {
  const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const segments = postContentSegments(body, attachments);
  return (
    <div className={`markdown-body ${compact ? "markdown-body-compact" : ""}`}>
      {segments.map((segment, index) => {
        if (segment.kind === "markdown") {
          return (
            <ReactMarkdown remarkPlugins={[remarkRelaxedStrong]} rehypePlugins={[rehypeSanitize]} components={{ pre: compact ? MarkdownCodePreview : MarkdownCodeBlock }} key={`markdown-${index}`}>
              {segment.body}
            </ReactMarkdown>
          );
        }
        const attachment = byId.get(segment.attachmentId);
        if (!attachment) return null;
        return (
          <div className="markdown-attachment-block" key={`attachment-${attachment.id}`}>
            <AttachmentViewer
              attachments={[attachment]}
              canDownload={canDownload}
              canEdit={canEditAttachments}
              compact={compact}
              onDelete={onDeleteAttachment}
              onUpdateMetadata={onUpdateAttachmentMetadata}
            />
          </div>
        );
      })}
    </div>
  );
}

function MarkdownCodePreview({ children }: { children?: ReactNode }) {
  const codeElement = isValidElement<{ children?: ReactNode }>(children) ? children : null;
  const code = textContent(codeElement?.props.children ?? children).replace(/\n$/, "");
  const lines = code.split(/\r?\n/);
  const preview = `${lines[0] ?? ""}${lines.length > 1 ? " ..." : ""}`;
  const { copyState, copyCode } = useCodeCopy(code);
  const copyLabel = copyState === "copied" ? "복사됨" : copyState === "error" ? "복사 실패" : "코드 전체 복사";

  return (
    <div className="markdown-code-preview" aria-label="코드 미리보기">
      <code>{preview}</code>
      <button type="button" onClick={() => void copyCode()} aria-label={copyLabel} title={copyLabel}>
        {copyState === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </div>
  );
}

function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const codeElement = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : null;
  const language = codeElement?.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] ?? "code";
  // react-markdown은 fenced code 끝에 개행 하나를 붙입니다. 사용자가 입력한 코드만 복사되도록
  // 그 개행 하나만 제거하고, 코드 안쪽의 나머지 공백과 줄바꿈은 그대로 보존합니다.
  const code = textContent(codeElement?.props.children ?? children).replace(/\n$/, "");
  const { copyState, copyCode } = useCodeCopy(code);

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{language}</span>
        <button type="button" onClick={() => void copyCode()} aria-label="코드 복사">
          {copyState === "copied" ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copyState === "copied" ? "복사됨" : copyState === "error" ? "복사 실패" : "복사"}
        </button>
      </div>
      <pre tabIndex={0} aria-label={`${language} 코드 블록`}>{children}</pre>
    </div>
  );
}

function useCodeCopy(code: string) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  return { copyState, copyCode };
}

function textContent(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(value)) return textContent(value.props.children);
  return "";
}
