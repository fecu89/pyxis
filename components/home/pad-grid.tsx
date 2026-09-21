"use client";

import { CourseSelect } from "@/components/courses/course-select";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useState } from "react";
import { Archive, ArrowRight, ChevronRight, Copy, Folder, Globe2, LayoutTemplate, Link2, LockKeyhole, Plus, Star } from "lucide-react";
import { CreateBoardButton } from "@/components/home/create-board-actions";
import { PadReuseDialog } from "@/components/home/pad-reuse-dialog";
import { useConfirm } from "@/components/ui/app-dialog";
import { ContentCard, ContentCardBadge, ContentCardGrid } from "@/components/ui/content-card";
import { ContentCardMenuItem, ContentCardMenuSection } from "@/components/ui/content-card-menu";
import styles from "@/components/home/pad-dashboard.module.css";
import { APP_NAME } from "@/lib/brand";
import { formatDate } from "@/lib/format";
import type { DashboardBoard, DashboardFolder, TemplateBoard } from "@/lib/dashboard/types";
import { notifySidebarDataChanged } from "@/lib/sidebar-events";

export const scopeLabel = { PRIVATE: "비공개", LINK: "링크", PUBLIC: "공개" } as const;
const relationCardLabel = { OWNED: "내가 만든 패드", SHARED: "참여 중", MANAGED: "관리 중", SAVED: "저장한 패드" } as const;

export type DashboardSort = "UPDATED_DESC" | "TITLE_ASC";

export function sortPads<T extends { title: string; updatedAt: string }>(boards: T[], sort: DashboardSort) {
  return [...boards].sort((left, right) => sort === "TITLE_ASC"
    ? left.title.localeCompare(right.title, "ko")
    : Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

// 내 패드·즐겨찾기·검색·폴더 화면이 공유하는 카드 그리드입니다. 카드에 붙는 액션(즐겨찾기,
// 폴더 담기, 복제, 템플릿 표시)이 전부 여기 모여 있어서, 화면마다 어떤 패드 목록을 넘길지만
// 정하면 됩니다.
export function PadGrid({
  boards,
  folders,
  canCreateBoard,
  withCreateTile = false,
  headingLevel = 2,
}: {
  boards: DashboardBoard[];
  folders: DashboardFolder[];
  canCreateBoard: boolean;
  withCreateTile?: boolean;
  headingLevel?: 2 | 3;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reuseBoard, setReuseBoard] = useState<TemplateBoard | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Partial<DashboardBoard>>>({});
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => new Set());
  const visibleBoards = boards
    .filter((board) => !archivedIds.has(board.id))
    .map((board) => ({ ...board, ...overrides[board.id] }));

  function updateBoard(boardId: string, change: Partial<DashboardBoard>) {
    setOverrides((current) => ({ ...current, [boardId]: { ...current[boardId], ...change } }));
  }

  async function mutate(key: string, input: RequestInfo | URL, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch(input, init);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function toggleFavorite(board: Pick<TemplateBoard, "id" | "isFavorite">) {
    setOpenMenuId(null);
    setOpenFolderMenuId(null);
    const result = await mutate(`favorite-${board.id}`, `/api/boards/${board.id}/favorite`, { method: board.isFavorite ? "DELETE" : "PUT" });
    if (result) updateBoard(board.id, { isFavorite: !board.isFavorite });
  }

  async function toggleTemplate(board: DashboardBoard) {
    setOpenMenuId(null);
    setOpenFolderMenuId(null);
    const result = await mutate(`template-${board.id}`, `/api/boards/${board.id}/template`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isTemplate: !board.isTemplate }),
    });
    if (result) updateBoard(board.id, { isTemplate: !board.isTemplate });
  }

  async function setBoardFolder(boardId: string, folderId: string, included: boolean) {
    const result = await mutate(`folder-${folderId}-${boardId}`, "/api/dashboard", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-board", folderId, boardId, included }),
    });
    if (result) {
      const board = visibleBoards.find((item) => item.id === boardId);
      if (board) updateBoard(boardId, { folderIds: included ? [...new Set([...board.folderIds, folderId])] : board.folderIds.filter((id) => id !== folderId) });
      notifySidebarDataChanged("pad");
    }
  }

  async function archiveBoard(board: DashboardBoard) {
    if (!(await confirm(`"${board.title}" 패드를 보관함으로 옮길까요?\n7일 안에는 보관된 패드에서 복구할 수 있습니다.`))) return;
    setOpenMenuId(null);
    setOpenFolderMenuId(null);
    const result = await mutate(`archive-${board.id}`, `/api/boards/${board.id}`, { method: "DELETE" });
    if (result) setArchivedIds((current) => new Set(current).add(board.id));
  }

  return (
    <>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <ContentCardGrid>
        {withCreateTile && canCreateBoard && (
          <CreateBoardButton className={styles.createTile}>
            <span className={styles.createTileIcon}><Plus size={22} /></span>
            <span>새 패드 만들기</span>
          </CreateBoardButton>
        )}
        {visibleBoards.map((board) => (
          <ContentCard
            key={board.id}
            title={board.title}
            href={`/b/${board.slug}`}
            headingLevel={headingLevel}
            description={board.description || "패드에서 아이디어와 자료를 함께 나눠 보세요."}
            cover={board.backgroundImageUrl ? <img src={board.backgroundImageUrl} alt="" loading="lazy" /> : undefined}
            badges={<><ContentCardBadge>{relationCardLabel[board.relation]}</ContentCardBadge>{board.isTemplate && <ContentCardBadge tone="warning"><LayoutTemplate size={12} aria-hidden />템플릿</ContentCardBadge>}</>}
            favorite={board.isFavorite}
            metadata={<><span>{board.owner.name || APP_NAME}</span><span>섹션 {board._count.sections} · 글 {board._count.posts} · {formatDate(board.updatedAt)}</span></>}
            footerLabel={<>{board.discoveryScope === "PRIVATE" ? <LockKeyhole size={13} aria-hidden /> : board.discoveryScope === "LINK" ? <Link2 size={13} aria-hidden /> : <Globe2 size={13} aria-hidden />}{scopeLabel[board.discoveryScope]}</>}
            footerAction={<Link href={`/b/${board.slug}`} prefetch={false}>패드 열기<ArrowRight size={13} aria-hidden /></Link>}
            menu={{
              open: openMenuId === board.id,
              onOpenChange: (open) => { setOpenFolderMenuId(null); setOpenMenuId(open ? board.id : null); },
              children: <>
                {board.relation === "OWNED" && <ContentCardMenuSection label="교과목">
                  <CourseSelect kind="board" itemId={board.id} value={board.subjectId} label={`${board.title} 교과목`} refreshAfterChange={false} />
                </ContentCardMenuSection>}
                <ContentCardMenuItem icon={<Star size={15} fill={board.isFavorite ? "currentColor" : "none"} aria-hidden />} pressed={board.isFavorite} disabled={busy === `favorite-${board.id}`} onClick={() => void toggleFavorite(board)}>
                  {board.isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                </ContentCardMenuItem>
                <div className={styles.folderMenu}>
                  <ContentCardMenuItem icon={<Folder size={15} aria-hidden />} trailingIcon={<ChevronRight size={14} aria-hidden />} expanded={openFolderMenuId === board.id} controls={`pad-card-folders-${board.id}`} onClick={() => setOpenFolderMenuId((current) => current === board.id ? null : board.id)}>폴더에 담기</ContentCardMenuItem>
                  {openFolderMenuId === board.id && <div className={styles.folderOptions} id={`pad-card-folders-${board.id}`} role="group" aria-label={`${board.title} 폴더 선택`}>
                    {folders.length ? folders.map((folder) => (
                      <label key={folder.id}>
                        <input type="checkbox" checked={board.folderIds.includes(folder.id)} disabled={busy === `folder-${folder.id}-${board.id}`} onChange={(event) => void setBoardFolder(board.id, folder.id, event.target.checked)} />
                        {folder.name}
                      </label>
                    )) : <small>사이드바에서 폴더를 먼저 만들어 주세요.</small>}
                  </div>}
                </div>
                {canCreateBoard && <ContentCardMenuItem icon={<Copy size={15} aria-hidden />} onClick={() => { setOpenMenuId(null); setReuseBoard(board); }}>패드 복제</ContentCardMenuItem>}
                {board.canManageTemplate && <ContentCardMenuItem icon={<LayoutTemplate size={15} aria-hidden />} pressed={board.isTemplate} disabled={busy === `template-${board.id}`} onClick={() => void toggleTemplate(board)}>
                  {board.isTemplate ? "템플릿 표시 해제" : "템플릿으로 표시"}
                </ContentCardMenuItem>}
                {board.canArchive && <ContentCardMenuItem icon={<Archive size={15} aria-hidden />} danger disabled={busy === `archive-${board.id}`} onClick={() => void archiveBoard(board)}>보관함으로 이동</ContentCardMenuItem>}
              </>,
            }}
          />
        ))}
      </ContentCardGrid>
      {reuseBoard && <PadReuseDialog board={reuseBoard} onClose={() => setReuseBoard(null)} />}
    </>
  );
}
