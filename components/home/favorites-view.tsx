"use client";

import { useMemo, useState } from "react";
import { SortAsc, Star } from "lucide-react";
import { PadGrid, sortPads, type DashboardSort } from "@/components/home/pad-grid";
import { EmptyState } from "@/components/ui/feedback";
import libraryStyles from "@/components/ui/content-library.module.css";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import styles from "@/components/home/pad-dashboard.module.css";
import type { DashboardBoard, DashboardFolder } from "@/lib/dashboard/types";

// 즐겨찾기 화면은 카드 그리드만 보여줍니다 — 폴더·최근 방문·템플릿·접근 요청 같은 곁가지
// 섹션은 "내 패드"(/)에만 두기로 했습니다(사용자 피드백).
export function FavoritesView({
  boards,
  folders,
  canCreateBoard,
}: {
  boards: DashboardBoard[];
  folders: DashboardFolder[];
  canCreateBoard: boolean;
}) {
  const [sort, setSort] = useState<DashboardSort>("UPDATED_DESC");
  const favorites = useMemo(() => sortPads(boards.filter((board) => board.isFavorite), sort), [boards, sort]);

  return (
    <PageShell>
      <section className={libraryStyles.content}>
        <PageHeader eyebrow="PAD FAVORITES" title="즐겨찾기" description={`즐겨찾기한 패드 ${favorites.length}개를 모아 봅니다.`} />

        <div className={libraryStyles.toolbar}>
          <div className={libraryStyles.filters}>
            <label className={libraryStyles.select}><SortAsc size={15} aria-hidden /><span className={styles.visuallyHidden}>패드 정렬</span><select value={sort} onChange={(event) => setSort(event.target.value as DashboardSort)}><option value="UPDATED_DESC">최근 수정순</option><option value="TITLE_ASC">가나다순</option></select></label>
          </div>
        </div>

        {favorites.length > 0 ? (
          <div className={libraryStyles.groupList}>
            <section className={libraryStyles.group} aria-labelledby="favorite-pads">
              <header className={libraryStyles.groupHeader}><span className={libraryStyles.groupMarker} /><h2 id="favorite-pads">즐겨찾기</h2><span>{favorites.length}</span></header>
              <PadGrid boards={favorites} folders={folders} canCreateBoard={canCreateBoard} />
            </section>
          </div>
        ) : (
          <div className={libraryStyles.empty}><EmptyState icon={<Star size={24} />} title="즐겨찾기한 패드가 없습니다" description="패드 카드의 별 버튼을 누르면 여기에 모입니다." /></div>
        )}
      </section>
    </PageShell>
  );
}
