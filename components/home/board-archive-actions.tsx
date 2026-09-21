"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/app-dialog";

export function RestoreBoardButton({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function restoreBoard() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/boards/${boardId}/restore`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="button soft" onClick={restoreBoard} disabled={pending}>
        <ArchiveRestore size={15} />복구
      </button>
      {error && <small className="form-error compact" role="alert">{error}</small>}
    </>
  );
}

export function PurgeBoardButton({ board }: { board: { id: string; title: string } }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function purgeBoard() {
    const confirmed = await confirm({
      title: "패드 영구 삭제",
      description: `'${board.title}' 패드와 게시물·첨부파일을 모두 지웁니다. 되돌릴 수 없습니다.`,
      confirmLabel: "영구 삭제",
      danger: true,
    });
    if (!confirmed) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/boards/${board.id}/purge`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button type="button" className="button danger" onClick={purgeBoard} disabled={pending}>
        <Trash2 size={15} />{pending ? "삭제하는 중..." : "영구 삭제"}
      </button>
      {error && <small className="form-error compact" role="alert">{error}</small>}
    </>
  );
}
