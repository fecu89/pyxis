"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Pencil, SortAsc, Trash2 } from "lucide-react";
import { PadGrid, sortPads, type DashboardSort } from "@/components/home/pad-grid";
import { useDialog } from "@/components/ui/app-dialog";
import { EmptyState, InlineNotice } from "@/components/ui/feedback";
import libraryStyles from "@/components/ui/content-library.module.css";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import styles from "@/components/home/pad-dashboard.module.css";
import type { DashboardBoard, DashboardFolder } from "@/lib/dashboard/types";
import { PAD_HOME_PATH } from "@/lib/route-paths";
import { notifySidebarDataChanged } from "@/lib/sidebar-events";

// 폴더 칩 줄이 사이드바로 옮겨가면서, 폴더 하나하나가 이 화면(/folders/[folderId])을 갖습니다.
// 이름 변경·삭제도 여기서 합니다(예전에는 대시보드 본문의 칩에 붙어 있었습니다).
export function FolderView({
  folder,
  folders,
  boards,
  canCreateBoard,
}: {
  folder: DashboardFolder;
  folders: DashboardFolder[];
  boards: DashboardBoard[];
  canCreateBoard: boolean;
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [sort, setSort] = useState<DashboardSort>("UPDATED_DESC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folderBoards = useMemo(
    () => sortPads(boards.filter((board) => board.folderIds.includes(folder.id)), sort),
    [boards, folder.id, sort],
  );

  async function mutate(input: RequestInfo | URL, init: RequestInit) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function renameFolder() {
    // 네이티브 window.prompt는 브라우저 크롬 창이라 앱의 나머지 모달과 생김새가 따로 놉니다.
    const name = (await dialog.promptText({
      title: "폴더 이름 바꾸기",
      label: "폴더 이름",
      defaultValue: folder.name,
      maxLength: 60,
      validate: (value) => (value ? null : "이름을 입력해 주세요."),
    }))?.trim();
    if (!name || name === folder.name) return;
    const result = await mutate("/api/dashboard", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rename", folderId: folder.id, name }),
    });
    if (result) {
      notifySidebarDataChanged("pad", { folder: { id: folder.id, name } });
      router.refresh();
    }
  }

  async function deleteFolder() {
    if (!(await dialog.confirm(`"${folder.name}" 폴더를 삭제할까요? 패드는 삭제되지 않습니다.`))) return;
    const result = await mutate(`/api/dashboard?folderId=${encodeURIComponent(folder.id)}`, { method: "DELETE" });
    if (result) {
      notifySidebarDataChanged("pad", { folder: { id: folder.id, removed: true } });
      router.push(PAD_HOME_PATH);
    }
  }

  return (
    <PageShell>
      <section className={libraryStyles.content}>
        <PageHeader eyebrow="PAD FOLDER" title={folder.name} description={`이 폴더에 담긴 패드 ${folderBoards.length}개를 관리합니다.`} action={<div className={styles.folderActions}>
          <button type="button" className="button soft" disabled={busy} onClick={() => void renameFolder()}><Pencil size={15} />이름 변경</button>
          <button type="button" className="button danger" disabled={busy} onClick={() => void deleteFolder()}><Trash2 size={15} />폴더 삭제</button>
        </div>} />

        <div className={libraryStyles.toolbar}>
          <div className={libraryStyles.filters}>
            <label className={libraryStyles.select}><SortAsc size={15} aria-hidden /><span className={styles.visuallyHidden}>패드 정렬</span><select value={sort} onChange={(event) => setSort(event.target.value as DashboardSort)}><option value="UPDATED_DESC">최근 수정순</option><option value="TITLE_ASC">가나다순</option></select></label>
          </div>
        </div>
        {error ? <div className="mt-4"><InlineNotice tone="error">{error}</InlineNotice></div> : null}

        {folderBoards.length > 0 ? (
          <div className={libraryStyles.groupList}>
            <section className={libraryStyles.group} aria-labelledby="folder-pads">
              <header className={libraryStyles.groupHeader}><span className={libraryStyles.groupMarker} /><h2 id="folder-pads">패드</h2><span>{folderBoards.length}</span></header>
              <PadGrid boards={folderBoards} folders={folders} canCreateBoard={canCreateBoard} />
            </section>
          </div>
        ) : (
          <div className={libraryStyles.empty}><EmptyState icon={<FolderOpen size={24} />} title="이 폴더에 담긴 패드가 없습니다" description="패드 카드의 폴더 버튼에서 이 폴더를 선택하면 여기에 모입니다." /></div>
        )}
      </section>
    </PageShell>
  );
}
