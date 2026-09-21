import "server-only";

import Link from "next/link";
import { ArchiveRestore } from "lucide-react";
import type { ArchivedBoardSummary } from "@/lib/dashboard/types";
import { Logo } from "@/components/ui/logo";
import { APP_NAME } from "@/lib/brand";
import { PurgeBoardButton, RestoreBoardButton } from "@/components/home/board-archive-actions";
import { EmptyState } from "@/components/ui/feedback";
import libraryStyles from "@/components/ui/content-library.module.css";
import { PageHeader, PageShell } from "@/components/ui/page-layout";

export function Brand({ href = "/" }: { href?: string }) {
  return <Link href={href} prefetch={false} className="brand" aria-label={APP_NAME}><Logo size={29} /><span>{APP_NAME}</span></Link>;
}

// 내 패드 화면 안에 함께 묻혀 있어서 "찾기 어렵다"는 피드백을 받아, 사이드바 전용 항목 +
// /archived 라우트로 뺐습니다(app/(dashboard)/archived/page.tsx). 그 페이지의 유일한
// 내용이라 보관된 패드가 없어도 빈 화면 대신 안내 문구를 보여줍니다.
export function ArchivedBoards({ boards, userId, isSuperAdmin }: { boards: ArchivedBoardSummary[]; userId: string; isSuperAdmin: boolean }) {
  return (
    <PageShell>
      <section className={libraryStyles.content}>
        <PageHeader eyebrow="PAD ARCHIVE" title="보관된 패드" description="보관 후 7일 안에는 복구할 수 있고, 패드 소유자 또는 전체관리자는 언제든 영구 삭제할 수 있습니다." />
        {boards.length === 0 ? (
          <div className={libraryStyles.empty}><EmptyState icon={<ArchiveRestore size={24} />} title="보관된 패드가 없습니다" description="패드 설정의 ‘패드 보관’으로 보관하면 여기에 나타납니다." /></div>
        ) : (
          <div className="archived-pad-grid">
            {boards.map((board) => {
              const canPurge = isSuperAdmin || board.owner.id === userId;
              return (
                <article key={board.id} className="archived-board-card">
                  <span className="archive-icon"><ArchiveRestore size={19} /></span>
                  <div><h3>{board.title}</h3><p>{board.owner.name || APP_NAME} · {board.restorable ? `${board.remainingDays}일 남음` : "복구 기간 종료"}</p></div>
                  <div className="archived-board-actions">
                    {board.restorable && <RestoreBoardButton boardId={board.id} />}
                    {canPurge
                      ? <PurgeBoardButton board={{ id: board.id, title: board.title }} />
                      : !board.restorable && <small>패드 소유자 또는 전체관리자만 영구 삭제할 수 있습니다.</small>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}
