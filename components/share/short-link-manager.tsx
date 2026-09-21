"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Check, Copy, ExternalLink, Link2, LoaderCircle, Save, Trash2 } from "lucide-react";
import { useDialog } from "@/components/ui/app-dialog";
import {
  normalizeShortLinkSlug,
  SHORT_LINK_SLUG_MAX_LENGTH,
  shortLinkSlugError,
} from "@/lib/short-links/slug";

type TargetType = "BOARD" | "QUIZ_SESSION" | "FORM";
type ShortLinkData = { id: string; slug: string; targetType: TargetType; createdAt: string; updatedAt: string };

const subscribeToOrigin = () => () => {};
const getBrowserOrigin = () => window.location.origin;
const getServerOrigin = () => "";

export function ShortLinkManager({
  targetType,
  targetId,
  fixedLight = false,
  collapsible = false,
}: {
  targetType: TargetType;
  targetId: string;
  fixedLight?: boolean;
  collapsible?: boolean;
}) {
  const dialog = useDialog();
  const origin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);
  const query = useMemo(() => new URLSearchParams({ targetType, targetId }).toString(), [targetId, targetType]);
  const [shortLink, setShortLink] = useState<ShortLinkData | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/short-links?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json().catch(() => ({})) }))
      .then(({ response, result }) => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setError(typeof result.error === "string" ? result.error : "짧은 주소를 불러오지 못했습니다.");
          return;
        }
        const loaded = result.shortLink as ShortLinkData | null;
        setShortLink(loaded);
        setDraft(loaded?.slug ?? "");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("네트워크 연결을 확인해 주세요.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const normalizedDraft = normalizeShortLinkSlug(draft);
  const validationError = draft ? shortLinkSlugError(normalizedDraft) : null;
  const shortPath = shortLink ? `/go/${shortLink.slug}` : "";
  const shortUrl = shortPath && origin ? `${origin}${shortPath}` : shortPath;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = shortLinkSlugError(normalizedDraft);
    if (nextError) { setError(nextError); return; }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/short-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, slug: normalizedDraft }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "짧은 주소를 저장하지 못했습니다.");
        return;
      }
      setShortLink(result.shortLink as ShortLinkData);
      setDraft((result.shortLink as ShortLinkData).slug);
    } catch {
      setError("네트워크 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    const confirmed = await dialog.confirm({
      title: "짧은 주소를 삭제할까요?",
      description: "연결은 해제되지만, 이미 배포한 주소를 다른 사람이 가져가지 못하도록 계속 예약됩니다.",
      danger: true,
      confirmLabel: "삭제",
    });
    if (!confirmed) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/short-links?${query}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof result.error === "string" ? result.error : "짧은 주소를 삭제하지 못했습니다.");
        return;
      }
      setShortLink(null);
      setDraft("");
    } catch {
      setError("네트워크 연결을 확인해 주세요.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!shortUrl) return;
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      setError("");
    } catch {
      setError("주소를 복사하지 못했습니다. 입력칸의 주소를 직접 선택해 주세요.");
    }
  }

  const content = (
    <div className={collapsible ? "pt-3" : "mt-3"}>
      {loading ? (
        <p role="status" className={`flex min-h-10 items-center gap-2 text-xs font-bold ${fixedLight ? "text-brand-700" : "text-content-subtle"}`}>
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />짧은 주소를 확인하는 중...
        </p>
      ) : (
        <form onSubmit={save}>
          <label htmlFor={`short-link-${targetType}-${targetId}`} className={`block text-[11px] font-black ${fixedLight ? "text-brand-800" : "text-content-muted"}`}>
            원하는 주소
          </label>
          <div className={`mt-2 flex min-w-0 items-stretch overflow-hidden rounded-lg border ${fixedLight ? "border-brand-200 bg-white" : "border-line bg-surface"}`}>
            <span className={`grid shrink-0 place-items-center border-r px-2.5 font-mono text-xs font-black ${fixedLight ? "border-brand-200 text-brand-700" : "border-line text-content-subtle"}`}>/go/</span>
            <input
              id={`short-link-${targetType}-${targetId}`}
              value={draft}
              onChange={(event) => { setDraft(event.target.value.toLowerCase()); setError(""); }}
              maxLength={SHORT_LINK_SLUG_MAX_LENGTH}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="class-3"
              aria-invalid={Boolean(validationError)}
              className={`h-10 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm font-bold outline-none ${fixedLight ? "text-brand-950 placeholder:text-brand-300" : "text-content placeholder:text-content-subtle"}`}
            />
            <button
              type="submit"
              disabled={pending || Boolean(validationError) || !draft || normalizedDraft === shortLink?.slug}
              title={shortLink ? "짧은 주소 변경" : "짧은 주소 생성"}
              className={`grid w-10 shrink-0 place-items-center border-l disabled:opacity-35 ${fixedLight ? "border-brand-200 text-brand-700 hover:bg-brand-50" : "border-line text-brand hover:bg-brand-soft"}`}
              aria-label={shortLink ? "짧은 주소 변경" : "짧은 주소 생성"}
            >
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          <p className={`mt-1.5 text-[10px] leading-4 ${fixedLight ? "text-brand-700" : "text-content-subtle"}`}>영문 소문자, 숫자, 하이픈 3~40자</p>
        </form>
      )}

      {shortLink && !loading ? (
        <div className={`mt-3 flex min-w-0 items-center gap-1.5 border-t pt-3 ${fixedLight ? "border-brand-200" : "border-line"}`}>
          <code className={`min-w-0 flex-1 truncate text-xs font-bold ${fixedLight ? "text-brand-900" : "text-content-muted"}`}>{shortUrl}</code>
          <ActionButton fixedLight={fixedLight} label="짧은 주소 복사" onClick={() => void copy()}>
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          </ActionButton>
          <a href={shortPath} target="_blank" rel="noopener noreferrer" title="짧은 주소 열기" aria-label="짧은 주소 열기" className={actionClass(fixedLight)}>
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <ActionButton fixedLight={fixedLight} label="짧은 주소 삭제" danger onClick={() => void remove()} disabled={pending}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </ActionButton>
        </div>
      ) : null}
      {error ? <p role="alert" className={`mt-2 text-[11px] font-bold leading-4 ${fixedLight ? "text-danger-700" : "text-danger"}`}>{error}</p> : null}
    </div>
  );

  const heading = (
    <span className={`flex items-center gap-2 text-xs font-black ${fixedLight ? "text-brand-900" : "text-content"}`}>
      <Link2 className="h-4 w-4" aria-hidden />손으로 입력할 짧은 주소
      {shortLink ? <span className={`ml-auto text-[10px] ${fixedLight ? "text-brand-600" : "text-brand"}`}>설정됨</span> : null}
    </span>
  );

  if (collapsible) {
    return <details className={`mt-3 border-t pt-3 ${fixedLight ? "border-brand-200" : "border-line"}`}><summary className="cursor-pointer list-none">{heading}</summary>{content}</details>;
  }
  return <section aria-label="짧은 주소 관리" className={`mt-4 border-t pt-4 ${fixedLight ? "border-brand-200" : "border-line"}`}>{heading}{content}</section>;
}

function actionClass(fixedLight: boolean, danger = false) {
  if (danger) return "grid h-8 w-8 shrink-0 place-items-center rounded-md text-danger-700 hover:bg-danger-50";
  return fixedLight
    ? "grid h-8 w-8 shrink-0 place-items-center rounded-md text-brand-700 hover:bg-brand-100"
    : "grid h-8 w-8 shrink-0 place-items-center rounded-md text-content-muted hover:bg-surface-muted hover:text-brand";
}

function ActionButton({ fixedLight, label, danger = false, disabled = false, onClick, children }: {
  fixedLight: boolean;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`${actionClass(fixedLight, danger)} disabled:opacity-35`}>{children}</button>;
}
