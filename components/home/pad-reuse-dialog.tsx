"use client";

import { Check, Copy, Files, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { TemplateBoard } from "@/lib/dashboard/types";
import styles from "@/components/home/pad-reuse-dialog.module.css";
import { Modal } from "@/components/ui/modal";

type CloneOptions = {
  includeSections: boolean;
  includePosts: boolean;
  includeAttachments: boolean;
  includeSettings: boolean;
  includeMembers: boolean;
};

const initialOptions: CloneOptions = {
  includeSections: true,
  includePosts: true,
  includeAttachments: false,
  includeSettings: true,
  includeMembers: false,
};

export function PadReuseDialog({ board, embedded = false, onClose }: { board: TemplateBoard; embedded?: boolean; onClose?: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(`${board.title} 복사본`);
  const [options, setOptions] = useState(initialOptions);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
  }, []);

  function setOption(key: keyof CloneOptions, checked: boolean) {
    setOptions((current) => {
      const next = { ...current, [key]: checked };
      if (key === "includeSections" && !checked) {
        next.includePosts = false;
        next.includeAttachments = false;
      }
      if (key === "includePosts" && !checked) next.includeAttachments = false;
      if (key === "includePosts" && checked) next.includeSections = true;
      if (key === "includeAttachments" && checked) {
        next.includePosts = true;
        next.includeSections = true;
      }
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${board.id}/clone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, ...options }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "패드를 복제하지 못했습니다.");
      router.push(`/b/${result.board.slug}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "패드를 복제하지 못했습니다.");
      setSubmitting(false);
    }
  }

  async function copyAutoLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/b/${board.slug}/copy`);
      setError(null);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimer.current = null;
      }, 1800);
    } catch {
      setError("복제 링크를 복사하지 못했습니다.");
    }
  }

  const form = (
    <form className={`${styles.panel} ${embedded ? "" : styles.modalContent}`} onSubmit={submit} aria-label={`${board.title} 복제`}>
      {embedded ? <header className={styles.header}>
        <span className={styles.icon}><Files size={20} aria-hidden /></span>
        <div><span>BOARD REUSE</span><h2>{board.isTemplate ? "템플릿으로 새 패드 만들기" : "패드 복제"}</h2></div>
      </header> : null}
      {embedded ? <p className={styles.description}><b>{board.title}</b>의 필요한 항목만 골라 새 비공개 패드로 만듭니다.</p> : null}
      <label className={styles.titleField}>새 패드 제목<input autoFocus value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} /></label>
      <fieldset className={styles.options}>
        <legend>복제할 항목</legend>
        <label><input type="checkbox" checked={options.includeSections} onChange={(event) => setOption("includeSections", event.target.checked)} /><span><b>섹션</b><small>섹션 이름과 순서를 복제합니다.</small></span></label>
        <label><input type="checkbox" checked={options.includePosts} onChange={(event) => setOption("includePosts", event.target.checked)} /><span><b>게시물</b><small>게시된 글만 복제하고 새 패드 소유자를 작성자로 기록합니다.</small></span></label>
        <label data-disabled={!board.canCopyAttachments}><input type="checkbox" checked={options.includeAttachments} disabled={!board.canCopyAttachments} onChange={(event) => setOption("includeAttachments", event.target.checked)} /><span><b>첨부파일</b><small>{board.canCopyAttachments ? "로컬 파일은 새 UUID 저장명으로 복사합니다." : "원본 다운로드 권한이 필요합니다."}</small></span></label>
        <label><input type="checkbox" checked={options.includeSettings} onChange={(event) => setOption("includeSettings", event.target.checked)} /><span><b>패드 설정</b><small>레이아웃·필드·반응·작성 정책을 복제합니다.</small></span></label>
        <label data-disabled={!board.canCopyMembers}><input type="checkbox" checked={options.includeMembers} disabled={!board.canCopyMembers} onChange={(event) => setOption("includeMembers", event.target.checked)} /><span><b>멤버</b><small>{board.canCopyMembers ? "원본 소유자를 제외한 활성 멤버를 복제합니다." : "원본 패드 관리 권한이 필요합니다."}</small></span></label>
      </fieldset>
      <div className={styles.policy}>새 패드는 항상 비공개로 시작하며 원본의 비밀번호·동결·댓글·반응 이력은 복제하지 않습니다.</div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.actions}>
        <button type="button" className={styles.linkButton} onClick={copyAutoLink}>{copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}{copied ? "복사됨" : "자동 복제 링크"}</button>
        <button type="submit" className={styles.submit} disabled={submitting || !title.trim()}>{submitting ? <LoaderCircle className={styles.spin} size={16} aria-hidden /> : <Files size={16} aria-hidden />}{submitting ? "복제 중..." : "새 패드 만들기"}</button>
      </footer>
    </form>
  );

  if (embedded) return <div className={styles.embedded}>{form}</div>;
  return <Modal open onClose={() => onClose?.()} title={board.isTemplate ? "템플릿으로 새 패드 만들기" : "패드 복제"} description={`${board.title}의 필요한 항목만 골라 새 비공개 패드로 만듭니다.`} className="modal-md">{form}</Modal>;
}
