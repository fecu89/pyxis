"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, InlineNotice } from "@/components/ui/feedback";
import { FORM_CLOSED_MESSAGES, formClosedMessage, isDisplayOnly } from "@/lib/forms/field-types";
import { validateAnswer, type ValidatableField } from "@/lib/forms/validation";
import type { AnswerInput } from "@/lib/forms/response-schema";
import { AnswerField, type PublicField } from "@/components/forms/answer-fields";
import { shuffledCopy } from "@/lib/forms/shuffle";
import { requiredCompletion } from "@/lib/forms/progress";
import { reachableFormFields } from "@/lib/forms/branching";

// 응답 화면의 몸통입니다. 서버 페이지가 넘긴 설문 정의로 첫 화면을 그리고, 답을 모아
// `/api/public/forms/[slug]/responses`로 보냅니다. 질문을 만드는 `form-editor.tsx`와는 반대편
// 화면이라 상태 모양이 다릅니다 — 여기는 "질문 배열"이 아니라 "질문ID → 답" 맵을 듭니다.

type PublicForm = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  requiresLogin: boolean;
  allowMultipleResponses: boolean;
  allowEditAfterSubmit: boolean;
  shuffleFields: boolean;
  showProgressBar: boolean;
  confirmationMessage: string | null;
  fields: PublicField[];
};

type LoadState =
  | { kind: "closed"; title: string; description: string }
  | { kind: "error"; message: string }
  | { kind: "blocked" } // 1인 1응답이고 이미 응답했으며 수정도 안 되는 경우
  | { kind: "ready"; form: PublicForm; canEdit: boolean };

function toValidatableField(field: PublicField): ValidatableField {
  return {
    type: field.type,
    required: field.required,
    allowOther: field.allowOther,
    optionIds: field.options.map((option) => option.id),
    gridRows: field.gridRows,
    gridRequireOneResponsePerRow: field.gridRequireOneResponsePerRow,
    scaleMin: field.scaleMin,
    scaleMax: field.scaleMax,
    ratingMax: field.ratingMax,
    includeYear: field.includeYear,
    includeTime: field.includeTime,
    durationMode: field.durationMode,
    validation: field.validation,
  };
}

function toAnswerValue(input: AnswerInput | undefined) {
  return {
    textValue: input?.textValue ?? null,
    selectedOptionIds: input?.selectedOptionIds ?? [],
    numberValue: input?.numberValue ?? null,
    dateValue: input?.dateValue ?? null,
    timeValue: input?.timeValue ?? null,
    gridValue: input?.gridValue ?? [],
    signatureStrokes: input?.signatureStrokes ?? [],
    fileIds: input?.fileIds ?? [],
  };
}

/**
 * `shuffleFields`가 켜져 있으면 한 번 섞은 순서를 그대로 유지해야 응답 중에 문항이 널뛰지
 * 않습니다. 렌더 함수 안에서 `Math.random()`을 부르면 안 되므로(React 규칙: 같은 입력엔
 * 항상 같은 출력이어야 함), 서버에서 함께 받은 seed로 초기 상태를 한 번만 섞습니다. 그 뒤로는
 * 순서가 이미 정해진 배열을 그대로 읽기만 합니다.
 */
function seededRandom(seed: string) {
  let state = 2166136261;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function prepareFields(fields: PublicField[], shuffleFields: boolean, seed: string) {
  const random = seededRandom(seed);
  const mayShuffle = shuffleFields && !fields.some((field) => field.type === "SECTION_HEADER");
  return shuffledCopy(fields, mayShuffle, random).map((field) => ({
    ...field,
    options: shuffledCopy(field.options, field.shuffleOptions, random),
  }));
}

type FormRunnerInitialData = {
  form: PublicForm | { id: string; title: string; description: string | null; status: string; requiresLogin: boolean };
  closedReason: keyof typeof FORM_CLOSED_MESSAGES | null;
  closedMessage?: string | null;
  hasResponded: boolean;
  canEdit: boolean;
  existingAnswers?: Record<string, AnswerInput>;
  editError?: string | null;
  shuffleSeed: string;
};

function initialRunnerState(data: FormRunnerInitialData) {
  if (data.editError) return { state: { kind: "error", message: data.editError } as LoadState, answers: {} };
  if (data.closedReason) {
    return {
      state: {
        kind: "closed",
        title: data.form.title,
        description: formClosedMessage(data.closedReason, data.closedMessage),
      } as LoadState,
      answers: {},
    };
  }
  const form = data.form as PublicForm;
  if (!form.allowMultipleResponses && data.hasResponded && !data.canEdit) {
    return { state: { kind: "blocked" } as LoadState, answers: {} };
  }
  return {
    state: {
      kind: "ready",
      form: { ...form, fields: prepareFields(form.fields, form.shuffleFields, data.shuffleSeed) },
      canEdit: data.canEdit,
    } as LoadState,
    answers: data.existingAnswers ?? {},
  };
}

export function FormRunner({ slug, responseId, initialData }: { slug: string; responseId?: string; initialData: FormRunnerInitialData }) {
  const router = useRouter();
  const [initial] = useState(() => initialRunnerState(initialData));
  const state = initial.state;
  const [answers, setAnswers] = useState<Record<string, AnswerInput>>(initial.answers);
  const [fieldError, setFieldError] = useState<{ fieldId: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);

  if (state.kind === "error") return <InlineNotice tone="error">{state.message}</InlineNotice>;
  if (state.kind === "closed") {
    return (
      <EmptyState
        title={state.title}
        description={state.description}
      />
    );
  }
  if (state.kind === "blocked") {
    return <EmptyState title="이미 응답하셨어요" description="한 사람당 한 번만 응답할 수 있는 설문입니다." />;
  }

  const { form, canEdit } = state;
  const fields = reachableFormFields(form.fields, answers);
  const sections = fields.reduce<PublicField[][]>((groups, field) => {
    if (!groups.length || field.type === "SECTION_HEADER") groups.push([]);
    groups[groups.length - 1].push(field);
    return groups;
  }, []);
  const activeSectionIndex = Math.min(sectionIndex, Math.max(0, sections.length - 1));
  const activeFields = sections[activeSectionIndex] ?? [];
  const answerableFields = fields.filter((field) => !isDisplayOnly(field.type));
  const progress = requiredCompletion(answerableFields, (field) =>
    validateAnswer(toValidatableField(field), toAnswerValue(answers[field.id])) === null,
  );

  function updateAnswer(fieldId: string, patch: AnswerInput) {
    setAnswers((prev) => ({ ...prev, [fieldId]: { ...prev[fieldId], ...patch } }));
    setFieldError((prev) => (prev?.fieldId === fieldId ? null : prev));
  }

  function validateFields(targetFields: PublicField[]) {
    for (const field of targetFields) {
      if (isDisplayOnly(field.type)) continue;
      const message = validateAnswer(toValidatableField(field), toAnswerValue(answers[field.id]));
      if (message) {
        setFieldError({ fieldId: field.id, message });
        document.getElementById(`field-${field.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
      }
    }
    return true;
  }

  async function submit() {
    if (!validateFields(fields)) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(responseId
        ? `/api/public/forms/${slug}/responses/${responseId}`
        : `/api/public/forms/${slug}/responses`, {
        method: canEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: Object.fromEntries(fields.flatMap((field) => answers[field.id] ? [[field.id, answers[field.id]]] : [])) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.fieldId) {
          setFieldError({ fieldId: data.fieldId, message: data.error });
          document.getElementById(`field-${data.fieldId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          setSubmitError(typeof data.error === "string" ? data.error : "설문을 제출하지 못했습니다.");
        }
        return;
      }
      router.push(`/s/${slug}/done?responseId=${encodeURIComponent(String(data.response.id))}`);
    } catch {
      setSubmitError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 pb-24">
      {form.showProgressBar && progress.total > 0 && (
        <div className="sticky top-0 z-10 -mx-4 bg-background/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-inset">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}

      <header className="rounded-2xl border-t-4 border-brand bg-surface p-5 shadow-sm">
        <h1 className="text-2xl font-black text-content">{form.title || "제목 없는 설문지"}</h1>
        {form.description && <p className="mt-2 whitespace-pre-wrap text-sm text-content-muted">{form.description}</p>}
        {form.requiresLogin && <p className="mt-3 text-xs font-bold text-content-subtle">이 설문은 로그인 계정으로 응답합니다.</p>}
        {canEdit && <div className="mt-3"><InlineNotice tone="info">이미 응답하셨습니다. 지금 제출하면 기존 응답을 덮어씁니다.</InlineNotice></div>}
      </header>

      {submitError && <InlineNotice tone="error">{submitError}</InlineNotice>}

      {activeFields.map((field) => (
        <section key={field.id} id={`field-${field.id}`} className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          {isDisplayOnly(field.type) ? (
            <>
              {field.title && <h2 className="text-lg font-black text-content">{field.title}</h2>}
              {field.description && <p className="mt-2 whitespace-pre-wrap text-sm text-content-muted">{field.description}</p>}
            </>
          ) : (
            <>
              <p className="text-sm font-black text-content">
                {field.title}
                {field.required && <span className="ml-1 text-danger" aria-hidden>*</span>}
              </p>
              {field.description && <p className="mt-1 whitespace-pre-wrap text-xs text-content-muted">{field.description}</p>}
              <div className="mt-4">
                <AnswerField field={field} slug={slug} value={answers[field.id]} onChange={(patch) => updateAnswer(field.id, patch)} />
              </div>
              {fieldError?.fieldId === field.id && (
                <p role="alert" className="mt-2 text-xs font-bold text-danger">{fieldError.message}</p>
              )}
            </>
          )}
        </section>
      ))}

      <div className="flex justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={() => setSectionIndex((value) => Math.max(0, value - 1))}
          disabled={activeSectionIndex === 0 || submitting}
          className="min-h-11 rounded-xl border border-line bg-surface px-5 text-sm font-black text-content-muted disabled:opacity-30"
        >
          이전
        </button>
        {activeSectionIndex < sections.length - 1 ? (
          <button
            type="button"
            onClick={() => { if (validateFields(activeFields)) { setSectionIndex(activeSectionIndex + 1); window.scrollTo({ top: 0, behavior: "smooth" }); } }}
            className="min-h-11 rounded-xl bg-brand px-6 text-sm font-black text-on-brand hover:bg-brand-strong"
          >
            다음
          </button>
        ) : (
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand px-6 text-sm font-black text-on-brand transition hover:bg-brand-strong disabled:opacity-50"
        >
          {submitting ? "제출하는 중..." : "제출"}
        </button>
        )}
      </div>
    </div>
  );
}
