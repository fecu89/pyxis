import Link from "next/link";
import { ExternalLink, FileText, MessageCircle, Paperclip, Smile } from "lucide-react";
import { StatusBadge } from "@/components/ui/data-display";
import { EmptyState } from "@/components/ui/feedback";
import { formatDateTime } from "@/lib/format";
import type { StudentPadPostHistoryEntry } from "@/lib/activity/students";

const STATUS_LABEL = {
  PUBLISHED: "게시됨",
  PENDING: "승인 대기",
  REJECTED: "반려됨",
} as const;

export function StudentPadHistory({ posts }: { posts: StudentPadPostHistoryEntry[] }) {
  return (
    <section aria-labelledby="student-pad-history-title">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand">Pad writing</p>
          <h2 id="student-pad-history-title" className="mt-1 text-xl font-black tracking-tight text-content">작성한 패드 글</h2>
        </div>
        {posts.length > 0 ? <span className="text-xs font-bold text-content-muted">최근 {posts.length}개</span> : null}
      </div>

      {posts.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="아직 작성한 패드 글이 없어요"
          description="패드에 글을 작성하면 게시 상태와 함께 이곳에 쌓입니다."
        />
      ) : (
        <ul className="grid gap-3">
          {posts.map((post) => (
            <li key={post.id}>
              <article className="rounded-[22px] border border-line bg-surface p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={post.status} label={STATUS_LABEL[post.status]} />
                  <span className="text-xs font-bold text-content-muted">{post.boardTitle}</span>
                  {post.sectionTitle ? <span className="text-xs text-content-subtle">· {post.sectionTitle}</span> : null}
                  <time className="ml-auto text-[11px] font-bold text-content-subtle" dateTime={post.createdAt.toISOString()}>
                    {formatDateTime(post.createdAt)}
                  </time>
                </div>

                <h3 className="mt-3 text-base font-black leading-6 text-content">
                  <Link href={post.href} className="inline-flex items-start gap-1.5 hover:text-brand">
                    <span>{post.title}</span>
                    <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0" aria-hidden />
                  </Link>
                </h3>
                {post.body ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-content-muted">{post.body}</p> : null}
                {post.status === "REJECTED" && post.moderationReason ? (
                  <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs font-bold text-danger-soft-fg">반려 사유: {post.moderationReason}</p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-4 text-[11px] font-bold text-content-subtle">
                  <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" aria-hidden />첨부 {post.attachmentCount}</span>
                  <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" aria-hidden />댓글 {post.commentCount}</span>
                  <span className="inline-flex items-center gap-1"><Smile className="h-3.5 w-3.5" aria-hidden />반응 {post.reactionCount}</span>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
