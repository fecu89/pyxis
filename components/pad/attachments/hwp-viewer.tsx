"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, TriangleAlert } from "lucide-react";
import styles from "@/components/pad/attachments/document-viewer.module.css";

const RENDER_MARGIN = "300px";

let runtime: Promise<typeof import("@rhwp/core")> | null = null;

function loadRuntime() {
  runtime ??= (async () => {
    const rhwp = await import("@rhwp/core");
    await rhwp.default({ module_or_path: "/rhwp/rhwp_bg.wasm" });
    return rhwp;
  })().catch((reason) => {
    // 일시적인 WASM 로드 실패를 영구 캐시하지 않습니다. 다음 열기에서는 다시 시도할 수 있습니다.
    runtime = null;
    throw reason;
  });
  return runtime;
}

type ViewerProxy = InstanceType<(typeof import("@rhwp/core"))["HwpViewer"]>;

type HwpViewerProps = {
  url: string;
  title: string;
  downloadUrl?: string;
};

export function HwpViewer(props: HwpViewerProps) {
  // URL이 바뀌면 문서 상태와 WASM 소유권을 한 번에 새 인스턴스로 교체합니다.
  return <HwpDocumentViewer key={props.url} {...props} />;
}

function HwpDocumentViewer({ url, title, downloadUrl }: HwpViewerProps) {
  const [viewer, setViewer] = useState<ViewerProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const owned: { free: () => void }[] = [];
    (async () => {
      try {
        const [rhwp, response] = await Promise.all([loadRuntime(), fetch(url, { signal: controller.signal })]);
        if (!response.ok) throw new Error("파일을 내려받지 못했습니다.");
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (disposed) return;

        const document = new rhwp.HwpDocument(bytes);
        owned.push(document);
        const createdViewer = new rhwp.HwpViewer(document);
        owned.push(createdViewer);
        const count = createdViewer.pageCount();
        if (disposed) return;

        setViewer(createdViewer);
        setPageCount(count);
        setLoading(false);
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : "문서를 열지 못했습니다.");
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
      // 자식 페이지 효과가 Blob URL과 예약 렌더를 먼저 정리한 다음 WASM 객체를 놓습니다.
      setTimeout(() => {
        for (const item of owned.reverse()) {
          try {
            item.free();
          } catch {
            // 이미 해제된 객체는 무시합니다.
          }
        }
      }, 0);
    };
  }, [url]);

  function trackVisiblePage() {
    const container = pagesRef.current;
    if (!container) return;
    const middle = container.scrollTop + container.clientHeight / 2;
    const rendered = Array.from(container.querySelectorAll<HTMLElement>("[data-page]"));
    for (const page of rendered) {
      if (page.offsetTop + page.offsetHeight >= middle) {
        setVisiblePage(Number(page.dataset.page));
        return;
      }
    }
  }

  function goToPage(pageNumber: number) {
    const container = pagesRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`);
    if (!container || !target) return;
    container.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
  }

  if (error) {
    return (
      <div className={styles.root}>
        <p className={styles.status}>
          <TriangleAlert size={22} aria-hidden />
          <strong>한글 문서를 열지 못했어요</strong>
          <span>{error}</span>
          {downloadUrl && <a href={downloadUrl}>파일 내려받기</a>}
        </p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.title}>{title}</span>
        <button type="button" aria-label="이전 쪽" disabled={visiblePage <= 1} onClick={() => goToPage(visiblePage - 1)}>
          <ChevronLeft size={16} />
        </button>
        <span className={styles.counter} aria-live="polite">
          {pageCount ? `${visiblePage} / ${pageCount}` : "여는 중…"}
        </span>
        <button type="button" aria-label="다음 쪽" disabled={!pageCount || visiblePage >= pageCount} onClick={() => goToPage(visiblePage + 1)}>
          <ChevronRight size={16} />
        </button>
      </div>

      <div className={styles.pages} ref={pagesRef} onScroll={trackVisiblePage} data-hwp-pages>
        {loading && (
          <p className={styles.status}><LoaderCircle size={20} className="spin" aria-hidden />한글 문서를 여는 중…</p>
        )}
        {viewer && Array.from({ length: pageCount }, (_, index) => (
          <HwpPageImage
            key={index + 1}
            viewer={viewer}
            pageNumber={index + 1}
            onError={setError}
          />
        ))}
      </div>
    </div>
  );
}

function HwpPageImage({ viewer, pageNumber, onError }: {
  viewer: ViewerProxy;
  pageNumber: number;
  onError: (message: string) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [active, setActive] = useState(pageNumber === 1);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1 / 1.414");

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const observer = new IntersectionObserver((entries) => {
      setActive(entries.some((entry) => entry.isIntersecting));
    }, { root: holder.closest("[data-hwp-pages]") ?? null, rootMargin: RENDER_MARGIN });
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function releaseObjectUrl() {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
      setObjectUrl(null);
    }

    if (active) {
      // 페이지별 동기 WASM 렌더 사이에 이벤트 루프를 한 번 양보합니다.
      timer = setTimeout(() => {
        if (cancelled) return;
        try {
          const svg = viewer.renderPageSvg(pageNumber - 1);
          if (cancelled) return;
          const nextUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
          releaseObjectUrl();
          objectUrlRef.current = nextUrl;
          setObjectUrl(nextUrl);
        } catch (reason) {
          onError(reason instanceof Error ? reason.message : "한글 문서 쪽을 그리지 못했습니다.");
        }
      }, 0);
    } else {
      releaseObjectUrl();
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      releaseObjectUrl();
    };
  }, [active, onError, pageNumber, viewer]);

  return (
    <div
      className={styles.page}
      data-page={pageNumber}
      ref={holderRef}
      style={{ width: "min(100%, 640px)", aspectRatio }}
    >
      {objectUrl && (
        <img
          src={objectUrl}
          alt={`${pageNumber}쪽`}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth > 0 && image.naturalHeight > 0) {
              setAspectRatio(`${image.naturalWidth} / ${image.naturalHeight}`);
            }
          }}
        />
      )}
    </div>
  );
}
