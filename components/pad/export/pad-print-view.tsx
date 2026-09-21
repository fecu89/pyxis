/* eslint-disable @next/next/no-img-element */
import { PostBody } from "@/components/pad/post-body";
import { PrintActions } from "@/components/pad/export/print-actions";
import type { PadData } from "@/components/pad/types";
import styles from "@/components/pad/export/pad-print-view.module.css";

// 다른 독자가 실제 보드에서 이미 볼 수 있는 범위(PUBLISHED)만 보여줍니다 — 승인 대기·거절 게시물은
// 여기서도 제외합니다. 일반 보드 조회가 읽을 수 있는 게시물을 모두 담으므로 인쇄도 전체를 포함합니다.
export function PadPrintView({ board }: { board: PadData }) {
  const sections = board.sections.map((section) => ({
    ...section,
    posts: section.posts.filter((post) => post.status === "PUBLISHED"),
  }));
  const hasAnyPost = sections.some((section) => section.posts.length > 0);

  return (
    <>
      <PrintActions targetId="print-content" fileName={board.title} />
      <div id="print-content" className={styles.page}>
        <header className={styles.header}>
          <h1>{board.title}</h1>
          {board.description && <p>{board.description}</p>}
        </header>
        {!hasAnyPost && <p className={styles.empty}>아직 게시된 글이 없어요.</p>}
        {sections.map((section) => section.posts.length > 0 && (
          <section key={section.id} className={styles.section}>
            <h2>{section.title}</h2>
            {section.posts.map((post) => (
              <article key={post.id} className={styles.post}>
                {(board.showAuthor || board.showTimestamp) && (
                  <div className={styles.postMeta}>
                    {board.showAuthor && <span>{post.author.name || "이름 없는 친구"}</span>}
                    {board.showTimestamp && <time dateTime={post.createdAt}>{new Intl.DateTimeFormat("ko", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(post.createdAt))}</time>}
                  </div>
                )}
                {post.title && <h3>{post.title}</h3>}
                {post.body && <PostBody body={post.body} />}
                {post.attachments.some((attachment) => attachment.type === "IMAGE") && (
                  <div className={styles.images}>
                    {post.attachments.filter((attachment) => attachment.type === "IMAGE").map((attachment) => (
                      <img key={attachment.id} src={`/f/${attachment.id}`} alt={attachment.altText || attachment.originalName} />
                    ))}
                  </div>
                )}
              </article>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
