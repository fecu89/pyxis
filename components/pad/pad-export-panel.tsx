"use client";

import { Archive, FileSpreadsheet, FileText, MonitorPlay, Printer } from "lucide-react";
import { boardRoutePath } from "@/lib/board/route-paths";
import styles from "@/components/pad/pad-export-panel.module.css";

// 인쇄·발표는 보드를 읽을 수 있는 사람 누구나 쓸 수 있어(이미 화면에서 보는 내용과 같은 노출 수준),
// 이 패널 자체는 공유·활동 패널처럼 누구에게나 열립니다. CSV·XLSX·ZIP은 승인 대기·거절 게시물까지
// 포함한 대량 반출이라 canManage(보드 관리자)일 때만 노출합니다(padupgrade.md 8.3, lib/exports/overview.md 참고).
export function PadExportPanel({ board, canManage }: { board: { id: string; slug: string }; canManage: boolean }) {
  return (
    <div className={styles.panel}>
      <section>
        <div className={styles.sectionHeading}>
          <div><h3>화면으로 보기</h3><p>현재 공개된 게시물을 인쇄하거나 슬라이드로 보여줘요.</p></div>
        </div>
        <div className={styles.linkRow}>
          <a href={`${boardRoutePath(board.slug)}/print`} target="_blank" rel="noopener noreferrer"><span className={styles.icon}><Printer size={18} /></span><span><b>인쇄용 페이지</b><small>PDF·PNG로 저장</small></span></a>
          <a href={`${boardRoutePath(board.slug)}/present`} target="_blank" rel="noopener noreferrer"><span className={styles.icon}><MonitorPlay size={18} /></span><span><b>발표 모드</b><small>게시물을 한 장씩 표시</small></span></a>
        </div>
      </section>
      {canManage && (
        <section>
          <div className={styles.sectionHeading}>
            <div><h3>데이터 내보내기</h3><p>패드 관리자만 사용할 수 있어요.</p></div>
          </div>
          <div className={`${styles.linkRow} ${styles.dataLinks}`}>
            <a href={`/api/boards/${board.id}/exports/csv?type=posts`}><FileText size={17} /><span><b>게시물</b><small>CSV</small></span></a>
            <a href={`/api/boards/${board.id}/exports/csv?type=comments`}><FileText size={17} /><span><b>댓글</b><small>CSV</small></span></a>
            <a href={`/api/boards/${board.id}/exports/csv?type=reactions`}><FileText size={17} /><span><b>반응</b><small>CSV</small></span></a>
            <a href={`/api/boards/${board.id}/exports/xlsx`}><FileSpreadsheet size={17} /><span><b>전체 데이터</b><small>XLSX</small></span></a>
            <a href={`/api/boards/${board.id}/exports/attachments-zip`}><Archive size={17} /><span><b>첨부파일 전체</b><small>ZIP</small></span></a>
          </div>
          <p className={styles.note}>게시물·댓글·반응 내보내기에는 승인 대기·거절된 글도 함께 담깁니다. 첨부파일 ZIP은 패드의 첨부 다운로드 정책이 꺼져 있으면 받을 수 없어요.</p>
        </section>
      )}
    </div>
  );
}
