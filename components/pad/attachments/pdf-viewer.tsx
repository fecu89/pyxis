"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize2, Minus, Plus, TriangleAlert } from "lucide-react";
import styles from "@/components/pad/attachments/document-viewer.module.css";

/**
 * PDF 뷰어. pdf.js로 직접 그립니다.
 *
 * **왜 iframe이 아닌가.** 예전에는 `<iframe src="/f/…">` 하나였는데 화면에 아무것도 뜨지 않았습니다.
 * 파일 응답에 `X-Frame-Options: DENY`와 CSP `frame-ancestors 'none'`이 붙어 있어서(next.config.ts,
 * proxy.ts) 같은 출처인데도 프레임이 막히기 때문입니다. 그 헤더를 푸는 대신 pdf.js를 씁니다 —
 * 바이트를 fetch해서 캔버스에 그리므로 프레임을 아예 쓰지 않고, 보안 헤더를 그대로 둘 수 있습니다.
 * 덤으로 iOS Safari가 iframe 안 PDF의 첫 페이지만 보여 주는 문제도 사라집니다.
 *
 * 워커·cmaps·표준 폰트·WASM은 `/pdfjs/`에서 같은 출처로 받습니다(scripts/sync-pdfjs-assets.mjs).
 * CSP가 `default-src 'self'`라 외부 CDN은 쓸 수 없고, WASM 컴파일에는 `'wasm-unsafe-eval'`이
 * 필요해 proxy.ts에 더해 두었습니다.
 */

// 한 번에 다 그리지 않고 보이는 곳 주변만 그립니다. 200쪽짜리 문서를 열자마자 200개의 캔버스를
// 만들면 탭이 멎습니다.
const RENDER_MARGIN = "300px";
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

// pdf.js가 내보내는 타입을 그대로 씁니다(`import type`이라 번들에는 안 들어갑니다).
// 예전에는 필요한 모양만 손으로 적고 `as unknown as`로 캐스팅했는데, 그게 실제 API와
// 어긋난 걸 타입 검사가 못 잡아 화면에서 터졌습니다 — v6의 destroy()는 문서 프록시가 아니라
// **로딩 작업**에 있습니다.
type PdfModule = typeof import("pdfjs-dist");
type LoadingTask = ReturnType<PdfModule["getDocument"]>;

export function PdfViewer({ url, title, downloadUrl }: {
  url: string;
  title: string;
  downloadUrl?: string;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [visiblePage, setVisiblePage] = useState(1);
  // null은 화면 맞춤입니다. 슬라이드처럼 가로가 긴 페이지는 뷰어 폭에 맞춰 자동 축소하고,
  // 사용자가 +/-를 누른 뒤에만 고정 배율로 전환합니다.
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const [firstPageWidth, setFirstPageWidth] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [error, setError] = useState("");
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = pagesRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let task: LoadingTask | null = null;

    (async () => {
      try {
        // pdf.js는 800KB가 넘습니다. 첨부에 PDF가 있을 때만 받도록 여기서 동적으로 부릅니다.
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        task = pdfjs.getDocument({
          url,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          wasmUrl: "/pdfjs/wasm/",
          // PDF 안의 자바스크립트(Acrobat 스크립팅)는 pdf.js v6에서 기본으로 꺼져 있고, 우리는
          // 켜지 않습니다. XFA 폼도 미리보기에 필요 없어 그대로 둡니다(기본 false).
        });
        const proxy = await task.promise;
        if (disposed) return;
        const firstPage = await proxy.getPage(1);
        const firstViewport = firstPage.getViewport({ scale: 1 });
        firstPage.cleanup();
        if (disposed) return;
        setFirstPageWidth(firstViewport.width);
        setDocument(proxy);
        setPageCount(proxy.numPages);
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : "PDF를 열지 못했습니다.");
      }
    })();

    return () => {
      disposed = true;
      // 로딩 작업을 정리하면 그 아래 문서·워커 전송로까지 함께 정리됩니다.
      void task?.destroy();
    };
  }, [url]);

  // 스크롤 위치에서 "지금 몇 쪽을 보고 있는지" 알아냅니다. 도구 모음의 쪽 번호가 스크롤을
  // 따라가야 뷰어처럼 느껴집니다.
  const trackVisiblePage = useCallback(() => {
    const container = pagesRef.current;
    if (!container) return;
    const middle = container.scrollTop + container.clientHeight / 2;
    const pages = Array.from(container.querySelectorAll<HTMLElement>("[data-page]"));
    for (const page of pages) {
      if (page.offsetTop + page.offsetHeight >= middle) {
        setVisiblePage(Number(page.dataset.page));
        return;
      }
    }
  }, []);

  function goToPage(pageNumber: number) {
    const container = pagesRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-page="${pageNumber}"]`);
    if (!container || !target) return;
    container.scrollTo({ top: target.offsetTop - 12, behavior: "smooth" });
  }

  const fitScale = firstPageWidth && availableWidth
    ? Math.min(1, Math.max(0.1, availableWidth / firstPageWidth))
    : 1;
  const scale = zoomIndex === null ? fitScale : ZOOM_STEPS[zoomIndex];
  const zoomOutIndex = (() => {
    for (let index = ZOOM_STEPS.length - 1; index >= 0; index -= 1) {
      if (ZOOM_STEPS[index] < scale - 0.001) return index;
    }
    return -1;
  })();
  const zoomInIndex = ZOOM_STEPS.findIndex((step) => step > scale + 0.001);

  if (error) {
    return (
      <div className={styles.root}>
        <p className={styles.status}>
          <TriangleAlert size={22} aria-hidden />
          <strong>PDF를 열지 못했어요</strong>
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
        <button type="button" aria-label="축소" disabled={zoomOutIndex < 0} onClick={() => setZoomIndex(zoomOutIndex)}>
          <Minus size={16} />
        </button>
        <span className={styles.zoom}>{Math.round(scale * 100)}%</span>
        <button type="button" aria-label="확대" disabled={zoomInIndex < 0} onClick={() => setZoomIndex(zoomInIndex)}>
          <Plus size={16} />
        </button>
        <button
          type="button"
          aria-label="화면에 맞추기"
          aria-pressed={zoomIndex === null}
          title="화면에 맞추기"
          onClick={() => setZoomIndex(null)}
        >
          <Maximize2 size={16} />
        </button>
      </div>

      <div className={styles.pages} ref={pagesRef} onScroll={trackVisiblePage} data-pdf-pages>
        {!document && (
          <p className={styles.status}><LoaderCircle size={20} className="spin" aria-hidden />문서를 여는 중…</p>
        )}
        {document && Array.from({ length: pageCount }, (_, index) => (
          <PdfPageCanvas
            key={index + 1}
            document={document}
            pageNumber={index + 1}
            scale={scale}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * 한 쪽을 그립니다. 화면에 가까워질 때 비로소 그리고, 그리기 도중 확대율이 바뀌거나 화면에서
 * 벗어나면 진행 중인 렌더를 취소합니다 — 취소하지 않으면 확대할 때마다 이전 작업이 쌓입니다.
 */
function PdfPageCanvas({ document, pageNumber, scale }: {
  document: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(pageNumber === 1);
  const [baseSize, setBaseSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const observer = new IntersectionObserver((entries) => {
      setActive(entries.some((entry) => entry.isIntersecting));
    }, { root: holder.closest("[data-pdf-pages]") ?? null, rootMargin: RENDER_MARGIN });
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active || !canvas) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let page: PDFPageProxy | null = null;

    (async () => {
      page = await document.getPage(pageNumber);
      if (cancelled) return;
      const baseViewport = page.getViewport({ scale: 1 });
      setBaseSize({ width: Math.floor(baseViewport.width), height: Math.floor(baseViewport.height) });
      // 고해상도 화면에서 흐려지지 않도록 기기 픽셀 비율만큼 크게 그립니다(상한 2배).
      const ratio = Math.min(2, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: scale * ratio });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
      // v6은 canvasContext보다 canvas를 넘기는 쪽을 권합니다(컨텍스트는 하위 호환용).
      const render = page.render({ canvas, viewport });
      task = render;
      try {
        await render.promise;
      } catch {
        // 취소는 정상 흐름입니다(확대율 변경·화면 밖으로 이동).
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      page?.cleanup();
      // 캔버스 픽셀 버퍼는 DOM 크기와 별개입니다. 0으로 줄여야 브라우저가 실제 메모리를 놓습니다.
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = "";
    };
  }, [active, document, pageNumber, scale]);

  return (
    <div
      className={styles.page}
      data-page={pageNumber}
      ref={holderRef}
      // 아직 안 그린 쪽도 자리를 차지해야 스크롤 막대가 널뛰지 않습니다.
      style={baseSize
        ? { width: baseSize.width * scale, aspectRatio: `${baseSize.width} / ${baseSize.height}` }
        : { width: "min(100%, 640px)", aspectRatio: "1 / 1.414" }}
    >
      <canvas
        ref={canvasRef}
        width={0}
        height={0}
        aria-label={`${pageNumber}쪽`}
      />
    </div>
  );
}
