"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { BoardExportPost } from "@/lib/exports/data";
import styles from "@/components/pad/export/pad-presentation.module.css";

// 발표 화면도 마크다운 렌더러 청크를 슬라이드 전환 코드와 분리합니다(서버 렌더링은 유지).
const PostBody = dynamic(() => import("@/components/pad/post-body").then((mod) => mod.PostBody));

// 슬라이드 한 장 = 게시물 한 개. 좌우 화살표 키와 버튼으로 넘기며, 새로고침해도 처음부터
// 시작합니다(padupgrade.md 8.3 "게시물별 슬라이드 발표 모드" — 진행 상태 저장은 범위에 없음).
export function PadPresentation({ boardTitle, boardSlug, posts }: { boardTitle: string; boardSlug: string; posts: BoardExportPost[] }) {
  const [index, setIndex] = useState(0);
  const total = posts.length;
  const post = posts[index];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowRight") setIndex((current) => Math.min(current + 1, total - 1));
      if (event.key === "ArrowLeft") setIndex((current) => Math.max(current - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [total]);

  return (
    <div className={styles.stage}>
      <div className={styles.topBar}>
        <Link href={`/b/${encodeURIComponent(boardSlug)}`}><X size={16} /></Link>
        <b>{boardTitle}</b>
        {total > 0 && <span className={styles.counter}>{index + 1} / {total}</span>}
      </div>
      <div className={styles.slideArea}>
        {!post ? (
          <p className={styles.empty}>발표할 게시물이 없어요.</p>
        ) : (
          <article className={styles.slide}>
            <div className={styles.slideMeta}>
              <span>{post.author.name || "이름 없는 친구"}</span>
              {post.sectionTitle && <span>· {post.sectionTitle}</span>}
            </div>
            {post.title && <h1>{post.title}</h1>}
            {post.body && <PostBody body={post.body} />}
            {post.attachments.some((attachment) => attachment.type === "IMAGE") && (
              <div className={styles.images}>
                {post.attachments.filter((attachment) => attachment.type === "IMAGE").map((attachment) => (
                  <img key={attachment.id} src={`/f/${attachment.id}`} alt={attachment.originalName} />
                ))}
              </div>
            )}
          </article>
        )}
      </div>
      <div className={styles.controls}>
        <button type="button" onClick={() => setIndex((current) => Math.max(current - 1, 0))} disabled={index === 0}><ChevronLeft size={16} />이전</button>
        <button type="button" onClick={() => setIndex((current) => Math.min(current + 1, total - 1))} disabled={index >= total - 1}>다음<ChevronRight size={16} /></button>
      </div>
    </div>
  );
}
