"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowRight, BarChart3, CircleStop, FileText, Globe2, LockKeyhole, NotebookPen, RotateCcw, Send, Share2, Trash2, Users } from "lucide-react";
import { useDialog } from "@/components/ui/app-dialog";
import { ContentCard, ContentCardBadge } from "@/components/ui/content-card";
import { ContentCardMenuItem } from "@/components/ui/content-card-menu";
import type { FormListItem } from "@/lib/forms/list";
import { formatDate } from "@/lib/format";

const FormCollaboratorDialog = dynamic(() => import("@/components/forms/share-dialog").then((mod) => mod.FormCollaboratorDialog), { ssr: false });
const FormResponseShareDialog = dynamic(() => import("@/components/forms/response-share-panel").then((mod) => mod.FormResponseShareDialog), { ssr: false });

const STATUS_LOOK = {
  OPEN: { label: "응답 받는 중", tone: "brand" },
  DRAFT: { label: "초안", tone: "muted" },
  CLOSED: { label: "마감", tone: "warning" },
} as const;

export function FormListCard({ form, menuOpen, onMenuOpenChange, onError, onChanged }: {
  form: FormListItem;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onError: (message: string | null) => void;
  onChanged: () => void;
}) {
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<"responses" | "collaborators" | null>(null);
  const canManage = form.accessLevel !== "VIEWER";
  const canOwn = form.accessLevel === "OWNER";
  const title = form.title || "제목 없는 설문지";
  const look = STATUS_LOOK[form.status];

  async function mutate(action: "delete" | "close" | "publish") {
    if (busy) return;
    onMenuOpenChange(false);
    if (action !== "publish" && !(await dialog.confirm({
      title: action === "delete" ? `“${title}” 설문을 삭제할까요?` : "설문 응답을 마감할까요?",
      description: action === "delete"
        ? "목록에서 삭제되며 응답 링크를 사용할 수 없게 됩니다. 기존 응답 데이터는 보존됩니다."
        : "응답 링크와 기존 응답은 유지되지만 새 응답은 받지 않습니다. 나중에 다시 열 수 있습니다.",
      confirmLabel: action === "delete" ? "설문 삭제" : "응답 마감",
      danger: true,
    }))) return;
    setBusy(true);
    onError(null);
    try {
      const response = await fetch(`/api/forms/${form.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "설문을 변경하지 못했습니다.");
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function share(kind: "responses" | "collaborators") {
    onMenuOpenChange(false);
    setSharing(kind);
  }

  return (
    <>
      <ContentCard
        title={title}
        href={`/forms/${form.id}`}
        description={form.description || `${form.subject?.name || "미분류"} 설문`}
        badges={<>
          <ContentCardBadge tone={look.tone}><FileText size={12} aria-hidden />{look.label}</ContentCardBadge>
          {!canOwn && <ContentCardBadge tone="accent">{canManage ? "편집 공유" : "보기 전용"}</ContentCardBadge>}
          {form.frozen && <ContentCardBadge tone="muted" title="소유자 계정이 삭제되어 잠긴 설문입니다.">잠김</ContentCardBadge>}
        </>}
        metadata={<>
          <span>{form.ownerName || "설문 소유자"} · {form.subject?.name || "미분류"}</span>
          <span>질문 {form._count.fields} · 응답 {form._count.responses} · {formatDate(form.updatedAt)}</span>
        </>}
        footerLabel={<>{form.requiresLogin ? <LockKeyhole size={13} aria-hidden /> : <Globe2 size={13} aria-hidden />}{form.requiresLogin ? "로그인 필요" : "익명 응답 가능"}</>}
        footerAction={<Link href={`/forms/${form.id}`} prefetch={false}>설문 열기<ArrowRight size={13} aria-hidden /></Link>}
        menu={{
          open: menuOpen,
          onOpenChange: onMenuOpenChange,
          children: <>
            {canManage && <ContentCardMenuItem icon={<NotebookPen size={15} aria-hidden />} href={`/forms/${form.id}/edit`}>설문 편집</ContentCardMenuItem>}
            <ContentCardMenuItem icon={<BarChart3 size={15} aria-hidden />} href={`/forms/${form.id}/responses`}>응답 보기</ContentCardMenuItem>
            {form.status !== "DRAFT" && <ContentCardMenuItem icon={<Share2 size={15} aria-hidden />} onClick={() => share("responses")}>응답 링크 공유</ContentCardMenuItem>}
            {canOwn && <ContentCardMenuItem icon={<Users size={15} aria-hidden />} onClick={() => share("collaborators")}>공동 작업자 관리</ContentCardMenuItem>}
            {canManage && <ContentCardMenuItem
              icon={form.status === "OPEN" ? <CircleStop size={15} aria-hidden /> : form.status === "CLOSED" ? <RotateCcw size={15} aria-hidden /> : <Send size={15} aria-hidden />}
              disabled={busy}
              onClick={() => void mutate(form.status === "OPEN" ? "close" : "publish")}
            >{form.status === "OPEN" ? "응답 마감" : form.status === "CLOSED" ? "다시 응답 받기" : "설문 발행"}</ContentCardMenuItem>}
            {canOwn && <ContentCardMenuItem icon={<Trash2 size={15} aria-hidden />} danger disabled={busy} onClick={() => void mutate("delete")}>설문 삭제</ContentCardMenuItem>}
          </>,
        }}
      />
      {sharing === "collaborators" && <FormCollaboratorDialog open formId={form.id} formTitle={title} onClose={() => setSharing(null)} />}
      {sharing === "responses" && <FormResponseShareDialog open formId={form.id} slug={form.slug} title={title} canManage={canManage} onClose={() => setSharing(null)} />}
    </>
  );
}
