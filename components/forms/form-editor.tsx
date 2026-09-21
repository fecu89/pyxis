"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleStop, Plus, RotateCcw, Save, Send, Settings2, Share2 } from "lucide-react";
import { useDialog } from "@/components/ui/app-dialog";
import { InlineNotice } from "@/components/ui/feedback";
import { insertAfter, moveItem, removeAt, selectionAfterRemoval } from "@/lib/editor/list-ops";
import { useDocumentSave, useFlash, type SaveContext } from "@/lib/editor/use-document-save";
import { useListDrag } from "@/lib/editor/use-list-drag";
import { formCompletionError } from "@/lib/forms/field-schema";
import { blankField, duplicateField, hydrateField, serializeField, changeFieldType, type FieldDraft } from "@/components/forms/field-model";
import { FieldCard } from "@/components/forms/field-card";
import type { FormSettings } from "@/components/forms/form-settings-panel";
import { reconcileSavedFormIdentity } from "@/components/forms/reconcile-form-save";

// 설정과 QR 공유 화면은 편집기의 선택 기능입니다. 닫힌 상태에서도 컴포넌트를 렌더하면
// dynamic 청크가 즉시 요청되므로 실제로 열릴 때만 마운트하고, 버튼 intent에서 미리 받습니다.
const loadFormSettingsPanel = () => import("@/components/forms/form-settings-panel");
const loadFormResponseShareDialog = () => import("@/components/forms/response-share-panel");
const FormSettingsPanel = dynamic(() => loadFormSettingsPanel().then((mod) => mod.FormSettingsPanel), { ssr: false });
const FormResponseShareDialog = dynamic(() => loadFormResponseShareDialog().then((mod) => mod.FormResponseShareDialog), { ssr: false });

// 설문 편집기의 껍데기입니다. 질문 카드 하나하나는 field-card.tsx가, 유형별 설정은
// field-settings.tsx가, 저장·드래그는 lib/editor의 공통 훅이 맡습니다. 여기 남은 것은
// "문서 상태를 들고 있다가 그 조각들을 배치하는 일"뿐입니다.

type LoadedForm = FormSettings & {
  id: string;
  slug: string;
  status: "DRAFT" | "OPEN" | "CLOSED";
  responseCount: number;
  fields: FieldDraft[];
  availableSubjects: { id: string; name: string }[];
  /** 낙관적 동시성 잠금에 쓰는 원본 ISO 문자열. 저장할 때 그대로 돌려보냅니다. */
  updatedAt: string;
};

export function FormEditor({ formId, initialForm }: { formId: string; initialForm: ApiForm }) {
  const router = useRouter();
  const dialog = useDialog();
  const listRef = useRef<HTMLOListElement>(null);
  const [form, setForm] = useState<LoadedForm>(() => hydrateForm(initialForm));
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saveValidationError, setSaveValidationError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { message: toast, flash } = useFlash();
  const { dirty, saving: savingDocument, markDirty, save } = useDocumentSave({
    onSave: (context) => saveForm(context),
    intervalMs: 30_000,
    enabled: true,
  });
  const saving = savingDocument || busy;

  // 일반 질문의 제목을 입력할 때는 뒤쪽 섹션 후보가 변하지 않습니다. 예전에는 카드마다
  // fields 전체를 flatMap해 매 키 입력마다 O(질문²) 배열을 다시 만들었습니다. 섹션 구조·제목·
  // 순서가 바뀔 때만 다시 계산하고, 그 외 입력에서는 기존 배열 참조를 재사용합니다.
  const sectionTargetSignature = JSON.stringify(form.fields.map((field) => (
    field.type === "SECTION_HEADER" ? [field.clientId, field.title] : [field.clientId]
  )));
  const sectionTargetsByIndex = useMemo(() => form.fields.map((_, index) => (
    form.fields.flatMap((candidate, candidateIndex) => (
      candidate.type === "SECTION_HEADER" && candidateIndex > index
        ? [{ id: candidate.clientId, label: candidate.title || `섹션 ${candidateIndex + 1}` }]
        : []
    ))
  // fields의 후보 판정에 영향을 주는 모든 값은 위 signature에 들어 있습니다.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  )), [sectionTargetSignature]);

  const drag = useListDrag({
    axis: "y",
    count: form?.fields.length ?? 0,
    listRef,
    onReorder: (from, to) => moveField(from, to),
  });

  const loaded = form;
  function patchForm(fields: Partial<LoadedForm>) {
    setSaveValidationError(null);
    setForm((value) => (value ? { ...value, ...fields } : value));
    markDirty();
  }

  function patchField(index: number, patch: Partial<FieldDraft>) {
    setSaveValidationError(null);
    setForm((value) => {
      if (!value) return value;
      const fields = value.fields.map((field, fieldIndex) => {
        if (fieldIndex !== index) return field;
        // 유형 변경은 단순 병합이 아니라 "무엇을 남길지" 규칙이 있습니다(field-model.ts).
        return patch.type && patch.type !== field.type ? changeFieldType(field, patch.type) : { ...field, ...patch };
      });
      return { ...value, fields, ...(patch.type === "FILE_UPLOAD" ? { requiresLogin: true } : {}) };
    });
    markDirty();
  }

  function addField() {
    setSaveValidationError(null);
    const field = blankField();
    setForm((value) => ({ ...value, fields: [...value.fields, field] }));
    setSelected(loaded.fields.length);
    markDirty();
  }

  function duplicateAt(index: number) {
    patchForm({ fields: insertAfter(loaded.fields, index, duplicateField(loaded.fields[index])) });
    setSelected(index + 1);
    flash("질문을 복제했습니다.");
  }

  async function deleteAt(index: number) {
    if (loaded.fields.length === 1) return flash("마지막 질문은 삭제할 수 없습니다.");
    const confirmed = await dialog.confirm({
      title: `${index + 1}번 질문을 삭제할까요?`,
      description: "저장 전까지는 새로고침으로 되돌릴 수 있습니다.",
      danger: true,
      confirmLabel: "삭제",
    });
    if (!confirmed) return;
    const removed = loaded.fields[index];
    const fields = removeAt(loaded.fields, index).map((field) => ({
      ...field,
      branchRules: removed.type === "SECTION_HEADER"
        ? field.branchRules.filter((rule) => rule.destination !== removed.clientId)
        : field.branchRules,
    }));
    patchForm({ fields });
    setSelected(selectionAfterRemoval(selected, index, fields.length));
  }

  function moveField(from: number, to: number) {
    if (from === to) return;
    setSaveValidationError(null);
    setForm((value) => (value ? { ...value, fields: moveItem(value.fields, from, to) } : value));
    markDirty();
    setSelected(to);
  }

  async function saveForm({ mode, isCurrent }: SaveContext, confirmDestructive = false): Promise<boolean> {
    const document = form;
    if (!document) return false;
    if (!document.title.trim()) { setSaveValidationError("설문 제목을 입력해 주세요."); return false; }
    setError(null);
    setSaveValidationError(null);
    try {
      const response = await fetch(`/api/forms/${formId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.title,
          description: document.description.trim() || null,
          subjectName: document.subjectName.trim() || null,
          requiresLogin: document.requiresLogin,
          allowMultipleResponses: document.allowMultipleResponses,
          allowEditAfterSubmit: document.allowEditAfterSubmit,
          shuffleFields: document.shuffleFields,
          showProgressBar: document.showProgressBar,
          confirmationMessage: document.confirmationMessage.trim() || null,
          closedMessage: document.closedMessage.trim() || null,
          dailyResponseDigestEnabled: document.dailyResponseDigestEnabled,
          openAt: toIsoOrNull(document.openAt),
          closeAt: toIsoOrNull(document.closeAt),
          maxResponses: document.maxResponses,
          fields: document.fields.map(serializeField),
          confirmDestructive,
          // 이 문서를 불러온 시점의 값입니다. 서버가 지금 실제 값과 비교해, 다른 탭이나
          // 공유받은 EDITOR가 그 사이에 먼저 저장했으면 거부합니다(lib/forms/save.ts).
          expectedUpdatedAt: document.updatedAt,
        }),
      });
      const data = await response.json().catch(() => ({}));

      // 응답이 달린 질문을 지우려는 경우입니다. 몇 건이 사라지는지 보여 준 뒤 다시 보냅니다.
      if (response.status === 409 && data.needsConfirm) {
        const ok = await dialog.confirm({
          title: "응답도 함께 지울까요?",
          description: `지우려는 질문에 응답 ${data.answerCount}건이 달려 있습니다. 저장하면 그 응답은 되돌릴 수 없습니다.`,
          danger: true,
          confirmLabel: "질문과 응답 삭제",
        });
        if (!ok) { setError("질문을 되살리려면 새로고침해 주세요."); return false; }
        // 확인창이 열린 동안에도 편집은 계속할 수 있습니다. 그 사이 문서가 바뀌었다면 처음
        // 요청의 삭제 범위에 대한 승인을 새 문서에 재사용하면 안 됩니다. 최신 화면에서 다시
        // 저장하게 해 삭제 대상과 응답 건수를 서버가 다시 계산하도록 합니다.
        if (!isCurrent()) {
          setError("삭제 확인 중 설문이 바뀌었습니다. 현재 내용으로 다시 저장해 주세요.");
          return false;
        }
        // 승인 여부는 이 재시도 한 건에만 붙입니다. ref에 남기면 네트워크 실패 뒤의 전혀 다른
        // 저장이 확인 없이 응답을 지울 수 있습니다.
        return saveForm({ mode, isCurrent }, true);
      }

      // 다른 곳에서 먼저 저장한 경우입니다. 지금 편집 중인 화면과 서버가 어긋났으니, 자동으로
      // 합치는 대신 사용자가 직접 새로고침해서 최신 내용을 보게 합니다.
      if (response.status === 409 && data.needsReload) {
        setError(typeof data.error === "string" ? data.error : "다른 곳에서 먼저 저장했습니다. 새로고침 후 다시 시도해 주세요.");
        return false;
      }

      if (!response.ok || !data.form) {
        const message = typeof data.error === "string" ? data.error : "설문을 저장하지 못했습니다.";
        if (response.status === 400 && data.code === "FORM_VALIDATION_ERROR") {
          // 저장 중 고친 입력에 이전 문서의 검증 오류를 뒤늦게 덮어씌우지 않습니다.
          // 실패를 성공 처리하지는 않으므로 dirty는 유지되고 다음 자동저장이 재시도합니다.
          if (isCurrent()) setSaveValidationError(message);
        } else {
          // ID 불일치(400)·권한·인증·충돌·서버 장애는 입력 수정으로 해결되지 않습니다.
          setError(message);
        }
        return false;
      }
      const next = { ...hydrateForm(data.form), availableSubjects: document.availableSubjects };
      setForm((current) => isCurrent() ? next : reconcileSavedFormIdentity(current, next));
      if (isCurrent()) setSelected((value) => Math.min(value, next.fields.length - 1));
      if (isCurrent() && mode === "manual") flash(`질문 ${next.fields.length}개를 저장했습니다.`);
      if (isCurrent() && mode === "auto") flash("변경사항을 자동 저장했습니다.");
      return true;
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 저장해 주세요.");
      return false;
    }
  }

  async function publish() {
    const incomplete = formCompletionError(loaded.fields.map(serializeField));
    if (incomplete) {
      setSelected(incomplete.index);
      setError(`${incomplete.index + 1}번 질문을 완성해 주세요. ${incomplete.message}`);
      return;
    }
    if (!(await save("silent"))) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/forms/${formId}/publish`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (typeof data.fieldIndex === "number") setSelected(data.fieldIndex);
        setError(typeof data.error === "string" ? data.error : "설문을 발행하지 못했습니다.");
        return;
      }
      setForm((value) => (value ? {
        ...value,
        status: "OPEN",
        slug: typeof data.form?.slug === "string" ? data.form.slug : value.slug,
        updatedAt: typeof data.form?.updatedAt === "string" ? data.form.updatedAt : value.updatedAt,
      } : value));
      void loadFormResponseShareDialog();
      setShareOpen(true);
      flash("설문을 발행했습니다.");
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 발행해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function closeForm() {
    const confirmed = await dialog.confirm({
      title: "설문 응답을 마감할까요?",
      description: "응답 링크는 유지되지만 새 응답은 받지 않습니다. 필요하면 나중에 다시 열 수 있습니다.",
      danger: true,
      confirmLabel: "응답 마감",
    });
    if (!confirmed) return;
    if (dirty && !(await save("silent"))) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/forms/${formId}/close`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.form) {
        setError(typeof data.error === "string" ? data.error : "설문을 마감하지 못했습니다.");
        return;
      }
      setForm((value) => ({
        ...value,
        status: "CLOSED",
        updatedAt: typeof data.form.updatedAt === "string" ? data.form.updatedAt : value.updatedAt,
      }));
      setShareOpen(false);
      flash("설문 응답을 마감했습니다.");
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 마감해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (dirty) {
      const ok = await dialog.confirm({
        title: "저장하지 않고 나갈까요?",
        description: "저장하지 않은 변경사항이 사라집니다.",
        danger: true,
        confirmLabel: "나가기",
      });
      if (!ok) return;
    }
    router.push("/forms");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy={saving}>
      <header className="sticky top-0 z-20 flex items-center gap-1.5 border-b border-line bg-surface/95 px-2 py-2 backdrop-blur sm:gap-2 sm:px-4">
        <button type="button" onClick={() => void leave()} aria-label="설문 목록으로" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-content-muted transition hover:bg-surface-hover sm:h-10 sm:w-10 sm:rounded-xl">
          <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-black text-content">{loaded.title || "제목 없는 설문"}</p>
        <span
          role="status"
          aria-label={STATUS_LOOK[loaded.status].label}
          title={STATUS_LOOK[loaded.status].label}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${STATUS_LOOK[loaded.status].className}`}
        >
          <span className={`h-2 w-2 rounded-full ${STATUS_LOOK[loaded.status].dotClass}`} aria-hidden />
        </span>
        <span aria-live="polite" className="hidden text-xs font-bold text-content-subtle lg:inline">
          {saving ? "저장 중..." : dirty ? "자동 저장 대기" : "저장됨"}
        </span>
        <div className="flex h-8 shrink-0 items-stretch overflow-hidden rounded-lg border border-line bg-surface sm:h-10 sm:rounded-xl">
          <button
            type="button"
            onPointerEnter={() => void loadFormResponseShareDialog()}
            onFocus={() => void loadFormResponseShareDialog()}
            onClick={loaded.status === "OPEN" ? () => setShareOpen(true) : () => void publish()}
            disabled={saving}
            aria-label={loaded.status === "OPEN" ? "응답 링크 공유" : loaded.status === "CLOSED" ? "다시 응답 받기" : "설문 발행"}
            title={loaded.status === "OPEN" ? "응답 링크 공유" : loaded.status === "CLOSED" ? "다시 응답 받기" : "설문 발행"}
            className="inline-flex h-full w-8 items-center justify-center gap-2 border-0 border-r border-brand-strong bg-brand px-0 text-xs font-black text-on-brand transition hover:bg-brand-strong disabled:opacity-45 sm:w-auto sm:px-3"
          >
            {loaded.status === "OPEN"
              ? <Share2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
              : loaded.status === "CLOSED"
                ? <RotateCcw className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
                : <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />}
            <span className="hidden sm:inline">{loaded.status === "OPEN" ? "링크 공유" : loaded.status === "CLOSED" ? "다시 응답 받기" : "발행"}</span>
          </button>
          {loaded.status === "OPEN" && (
            <button
              type="button"
              onClick={() => void closeForm()}
              disabled={saving}
              aria-label="설문 응답 마감"
              title="설문 응답 마감"
              className="inline-flex h-full w-8 items-center justify-center gap-2 border-0 border-r border-line bg-danger-soft px-0 text-xs font-black text-danger-soft-fg transition hover:brightness-95 disabled:opacity-45 sm:w-auto sm:px-3"
            >
              <CircleStop className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden /><span className="hidden sm:inline">응답 마감</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void save("manual")}
            disabled={saving || !dirty}
            aria-label="설문 저장"
            title="저장 (Ctrl/Cmd + S, 30초마다 자동 저장)"
            className="inline-flex h-full w-8 items-center justify-center gap-2 border-0 border-r border-line bg-transparent px-0 text-xs font-black text-content-muted transition hover:bg-surface-hover hover:text-brand disabled:opacity-45 sm:w-auto sm:px-3"
          >
            <Save className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden /><span className="hidden sm:inline">저장</span>
          </button>
          <button
            type="button"
            onPointerEnter={() => void loadFormSettingsPanel()}
            onFocus={() => void loadFormSettingsPanel()}
            onClick={() => setSettingsOpen(true)}
            aria-label="설문 설정"
            title="설문 설정"
            className="inline-flex h-full w-8 items-center justify-center border-0 bg-transparent p-0 text-content-muted transition hover:bg-surface-hover hover:text-brand sm:w-10"
          >
            <Settings2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
          </button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {(error || saveValidationError) && <div className="mb-4"><InlineNotice tone="error">{error ?? saveValidationError}</InlineNotice></div>}

        <div className="mb-5 rounded-2xl border-t-4 border-brand bg-surface p-4 shadow-sm">
          <input
            value={loaded.title}
            onChange={(event) => patchForm({ title: event.target.value })}
            maxLength={200}
            placeholder="설문지 제목"
            aria-label="설문지 제목"
            className="min-h-12 w-full bg-transparent text-2xl font-black text-content outline-none placeholder:text-content-subtle"
          />
          <input
            value={loaded.description}
            onChange={(event) => patchForm({ description: event.target.value })}
            maxLength={3000}
            placeholder="설문지 설명"
            aria-label="설문지 설명"
            className="min-h-10 w-full bg-transparent text-sm text-content-muted outline-none placeholder:text-content-subtle"
          />
        </div>

        <ol ref={listRef} className="space-y-3">
          {loaded.fields.map((field, index) => (
            <li
              key={field.clientId}
              ref={drag.setItemRef(index)}
              onClickCapture={drag.suppressClickAfterDrag}
              className={`form-editor-field transition ${drag.dragIndex === index ? "opacity-40" : ""} ${
                drag.indicator === index ? "border-t-2 border-brand pt-2" : ""
              }`}
            >
              <FieldCard
                field={field}
                index={index}
                total={loaded.fields.length}
                selected={selected === index}
                sectionTargets={sectionTargetsByIndex[index] ?? []}
                onSelect={() => setSelected(index)}
                onChange={(patch) => patchField(index, patch)}
                onDuplicate={() => duplicateAt(index)}
                onDelete={() => void deleteAt(index)}
                dragHandleProps={{ onPointerDown: drag.handlePointerDown(index) }}
              />
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={addField}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface text-sm font-black text-content-muted transition hover:border-brand hover:text-brand"
        >
          <Plus className="h-5 w-5" aria-hidden />질문 추가
        </button>

        {loaded.status !== "DRAFT" && (
          <p className="mt-6 text-center text-xs text-content-muted">
            <button type="button" onPointerEnter={() => void loadFormResponseShareDialog()} onFocus={() => void loadFormResponseShareDialog()} onClick={() => setShareOpen(true)} className="font-black text-brand underline">응답 링크 공유</button>
            {" · "}지금까지 {loaded.responseCount}건
          </p>
        )}
      </main>

      {settingsOpen ? <FormSettingsPanel
        open={settingsOpen}
        value={loaded}
        subjects={loaded.availableSubjects}
        loginRequiredByFileUpload={loaded.fields.some((field) => field.type === "FILE_UPLOAD")}
        onChange={patchForm}
        onClose={() => setSettingsOpen(false)}
      /> : null}

      {shareOpen ? <FormResponseShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        formId={loaded.id}
        slug={loaded.slug}
        title={loaded.title}
      /> : null}

      {toast && (
        <p role="status" className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-black text-surface shadow-lg">
          {toast}
        </p>
      )}
    </div>
  );
}

const STATUS_LOOK = {
  DRAFT: { label: "응답 중지: 초안", className: "bg-danger-soft", dotClass: "bg-danger" },
  OPEN: { label: "응답 가능", className: "bg-success-soft", dotClass: "bg-success-soft-fg" },
  CLOSED: { label: "응답 중지: 마감", className: "bg-danger-soft", dotClass: "bg-danger" },
} as const;

/** 서버 응답은 그대로 믿지 않고 하나씩 꺼내 씁니다. 열이 늘어도 편집기가 깨지지 않습니다. */
type ApiForm = Record<string, unknown>;

function hydrateForm(raw: ApiForm): LoadedForm {
  const fields = (raw.fields as Parameters<typeof hydrateField>[0][]).map(hydrateField);
  return {
    id: String(raw.id),
    slug: String(raw.slug),
    status: raw.status as LoadedForm["status"],
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt.toISOString() : String(raw.updatedAt),
    title: String(raw.title ?? ""),
    description: (raw.description as string | null) ?? "",
    subjectName: ((raw.subject as { name?: string } | null)?.name) ?? "",
    requiresLogin: Boolean(raw.requiresLogin),
    allowMultipleResponses: Boolean(raw.allowMultipleResponses),
    allowEditAfterSubmit: Boolean(raw.allowEditAfterSubmit),
    shuffleFields: Boolean(raw.shuffleFields),
    showProgressBar: Boolean(raw.showProgressBar),
    confirmationMessage: (raw.confirmationMessage as string | null) ?? "",
    closedMessage: (raw.closedMessage as string | null) ?? "",
    dailyResponseDigestEnabled: raw.dailyResponseDigestEnabled !== false,
    openAt: toLocalInput(raw.openAt as string | null),
    closeAt: toLocalInput(raw.closeAt as string | null),
    maxResponses: (raw.maxResponses as number | null) ?? null,
    responseCount: ((raw._count as { responses?: number } | undefined)?.responses) ?? 0,
    // 편집기가 최소 하나는 그려야 하므로 비어 있으면 빈 질문을 놓습니다.
    fields: fields.length ? fields : [blankField()],
    availableSubjects: (raw.availableSubjects as { id: string; name: string }[]) ?? [],
  };
}

/**
 * `<input type="datetime-local">`이 읽는 모양으로. ISO 문자열을 그대로 넣으면 초·타임존이
 * 붙어 있어 브라우저가 비워 버립니다.
 */
function toLocalInput(iso: string | Date | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * `toLocalInput`의 역방향. `datetime-local`이 주는 "YYYY-MM-DDTHH:mm"은 초·타임존이 없어
 * 서버의 `z.iso.datetime()`을 통과하지 못합니다 — `new Date(...)`는 타임존 없는 문자열을
 * **브라우저 로컬 시각**으로 해석하므로, 그 해석 그대로 UTC ISO로 바꿔 보냅니다.
 */
function toIsoOrNull(localValue: string): string | null {
  if (!localValue) return null;
  const date = new Date(localValue);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
