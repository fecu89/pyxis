"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link2, LoaderCircle } from "lucide-react";
import styles from "@/components/pad/composer/link-preview-input.module.css";
import type { LinkPreview } from "@/lib/link-preview/types";

const previewConcurrency = 3;

type PreviewResult =
  | { url: string; preview: LinkPreview; error: null }
  | { url: string; preview: null; error: string };

function inputLines(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function normalizeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function requestPreview(url: string, signal: AbortSignal): Promise<PreviewResult> {
  try {
    const response = await fetch("/api/link-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
    const result = await response.json() as { preview?: LinkPreview; error?: string };
    if (!response.ok || !result.preview) throw new Error(result.error || "미리보기를 만들지 못했습니다.");
    return { url, preview: result.preview, error: null };
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
    return {
      url,
      preview: null,
      error: reason instanceof Error ? reason.message : "미리보기를 만들지 못했습니다.",
    };
  }
}

async function requestPreviews(urls: string[], signal: AbortSignal) {
  const results = new Array<PreviewResult>(urls.length);
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await requestPreview(urls[index], signal);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(previewConcurrency, urls.length) },
    () => worker(),
  ));
  return results;
}

export function LinkPreviewInput({
  selectedUrls,
  remainingSlots,
  onSelect,
}: {
  selectedUrls: readonly string[];
  remainingSlots: number;
  onSelect: (previews: LinkPreview[]) => void;
}) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const enteredCount = inputLines(value).length;

  useEffect(() => () => requestRef.current?.abort(), []);

  async function addLinks() {
    if (loading) return;
    const lines = inputLines(value);
    if (!lines.length) {
      setError("링크를 하나 이상 입력해 주세요.");
      setStatus("");
      return;
    }

    const selected = new Set(selectedUrls.map(normalizeHttpUrl).filter((url): url is string => Boolean(url)));
    const unique = new Set<string>();
    const invalid: string[] = [];
    const duplicates: string[] = [];
    for (const line of lines) {
      const normalized = normalizeHttpUrl(line);
      if (!normalized) {
        invalid.push(line);
      } else if (selected.has(normalized) || unique.has(normalized)) {
        duplicates.push(normalized);
      } else {
        unique.add(normalized);
      }
    }

    const candidates = Array.from(unique);
    const requested = candidates.slice(0, remainingSlots);
    const overflow = candidates.slice(remainingSlots);
    if (!requested.length) {
      setValue([...invalid, ...overflow].join("\n"));
      setError(remainingSlots < 1
        ? "게시물에는 파일과 링크를 합쳐 최대 20개까지 첨부할 수 있습니다."
        : "추가할 수 있는 새 링크가 없습니다.");
      setStatus(duplicates.length ? `이미 선택한 링크 ${duplicates.length}개는 제외했습니다.` : "");
      return;
    }

    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    setStatus(`${requested.length}개 링크의 정보를 확인하는 중입니다.`);
    try {
      const results = await requestPreviews(requested, controller.signal);
      const failed = results.filter((result) => !result.preview);
      const previews: LinkPreview[] = [];
      const previewUrls = new Set(selected);
      let canonicalDuplicates = 0;
      for (const result of results) {
        if (!result.preview) continue;
        const canonical = normalizeHttpUrl(result.preview.url);
        if (!canonical || previewUrls.has(canonical)) {
          canonicalDuplicates += 1;
          continue;
        }
        previewUrls.add(canonical);
        previews.push(result.preview);
      }
      onSelect(previews);
      setValue([...failed.map((result) => result.url), ...invalid, ...overflow].join("\n"));

      const excludedCount = duplicates.length + canonicalDuplicates;
      setStatus([
        previews.length ? `${previews.length}개 링크를 첨부 목록에 추가했습니다.` : "",
        excludedCount ? `중복 ${excludedCount}개는 제외했습니다.` : "",
      ].filter(Boolean).join(" "));
      setError([
        invalid.length ? `주소 형식 오류 ${invalid.length}개` : "",
        failed.length ? `미리보기 실패 ${failed.length}개${failed[0]?.error ? `: ${failed[0].error}` : ""}` : "",
        overflow.length ? `첨부 한도 초과 ${overflow.length}개` : "",
      ].filter(Boolean).join(" · "));
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "링크 정보를 확인하지 못했습니다.");
        setStatus("");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // 바깥 게시물 form과 중첩 form을 만들지 않습니다. 줄바꿈은 그대로 허용하고,
    // Ctrl/Cmd+Enter만 여러 링크 추가 단축키로 사용합니다.
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    void addLinks();
  }

  return (
    <div className={styles.root}>
      <div className={styles.inputRow}>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={"https://example.com/article\nhttps://youtu.be/…"}
          aria-label="첨부할 링크 목록"
          rows={3}
          maxLength={20 * 2048}
          disabled={loading || remainingSlots < 1}
        />
        <button type="button" className="button soft" onClick={() => void addLinks()} disabled={loading || remainingSlots < 1}>
          {loading ? <LoaderCircle className="spin" size={15} /> : <Link2 size={15} />}
          {loading ? "확인 중" : enteredCount > 1 ? `${enteredCount}개 추가` : "링크 추가"}
        </button>
      </div>
      <p className={styles.hint}>한 줄에 하나씩 입력하세요. Ctrl/⌘ + Enter로도 추가할 수 있어요. 남은 첨부 {remainingSlots}개</p>
      {status && <p className={styles.status} role="status">{status}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
