"use client";

import { useEffect, useState } from "react";
import { Download, PenLine } from "lucide-react";
import { EmptyState, InlineNotice, LoadingCard } from "@/components/ui/feedback";
import { formatDateTime } from "@/lib/format";
import { formatAnswerValue } from "@/lib/forms/answer-format";
import { FORM_FIELD_TYPE_LABELS } from "@/lib/forms/field-labels";
import { parseSignatureStrokes, strokesToSvgPath } from "@/lib/forms/signature";
import type { FormFieldType } from "@/lib/forms/field-types";

// 응답 화면(요약 / 질문별 / 개별 3탭)입니다. `lib/forms/summary.ts`는 server-only라 그 타입을
// 그대로 import하지 않고, 서버가 실제로 내려주는 JSON 모양을 여기 다시 적습니다 —
// form-runner.tsx의 PublicForm과 같은 관례입니다.

type OptionCount = { optionId: string; text: string; count: number; removed: boolean };
type FieldSummaryBase = { fieldId: string; fieldType: FormFieldType; title: string; answeredCount: number; skippedCount: number };
type FieldSummary =
  | (FieldSummaryBase & { kind: "CHOICE"; options: OptionCount[]; otherTexts: string[] })
  | (FieldSummaryBase & { kind: "GRID"; rows: { rowLabel: string; options: OptionCount[] }[] })
  | (FieldSummaryBase & { kind: "SCALE"; average: number | null; distribution: { value: number; count: number }[] })
  | (FieldSummaryBase & { kind: "TEXT"; sampleTexts: string[]; truncated: boolean })
  | (FieldSummaryBase & { kind: "VALUE"; sampleValues: string[]; truncated: boolean });

type FormSummary = { totalResponses: number; fields: FieldSummary[] };
type ResponseListItem = { id: string; respondentLabel: string; submittedAt: string | null; answeredCount: number };
type ResponseListPage = { items: ResponseListItem[]; totalCount: number; page: number; pageSize: number };
type ResponseAnswerDetail = {
  fieldId: string; fieldType: FormFieldType; fieldTitle: string; textValue: string | null;
  selectedOptionTexts: string[]; numberValue: number | null; dateValue: string | null;
  timeValue: string | null; gridValue: unknown; signatureStrokes: unknown;
  files: Array<{ id: string; originalName: string }>;
};
type ResponseDetail = { id: string; respondentLabel: string; submittedAt: string | null; answers: ResponseAnswerDetail[] };

export function ResponseSummary({ initialSummary, view = "summary" }: {
  initialSummary: FormSummary;
  view?: "summary" | "question";
}) {
  const [selectedFieldId, setSelectedFieldId] = useState(initialSummary.fields[0]?.fieldId ?? "");
  const selectedField = initialSummary.fields.find((field) => field.fieldId === selectedFieldId) ?? null;

  return (
    <div>
      {initialSummary.totalResponses === 0 ? (
        <EmptyState title="아직 응답이 없어요" description="응답 링크를 공유하면 여기에 결과가 쌓입니다." />
      ) : view === "summary" ? (
        <div className="space-y-4">
          <p className="text-sm font-bold text-content-muted">전체 응답 {initialSummary.totalResponses}건</p>
          {initialSummary.fields.map((field) => <FieldSummaryCard key={field.fieldId} field={field} />)}
        </div>
      ) : (
        <div>
          <select
            value={selectedFieldId}
            onChange={(event) => setSelectedFieldId(event.target.value)}
            className="mb-4 h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm font-bold"
          >
            {initialSummary.fields.map((field) => (
              <option key={field.fieldId} value={field.fieldId}>{field.title || "제목 없는 질문"}</option>
            ))}
          </select>
          {selectedField && <FieldSummaryCard field={selectedField} />}
        </div>
      )}
    </div>
  );
}

function Bar({ label, count, total, removed = false }: { label: string; count: number; total: number; removed?: boolean }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between gap-2 text-xs font-bold text-content">
        <span className={`truncate ${removed ? "text-content-subtle italic" : ""}`}>{label}{removed && " (지워진 보기)"}</span>
        <span className="shrink-0 text-content-muted">{count}명 · {pct}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-inset">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FieldSummaryCard({ field }: { field: FieldSummary }) {
  const typeLabel = FORM_FIELD_TYPE_LABELS[field.fieldType];

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="text-sm font-black text-content">{field.title || "제목 없는 질문"}</p>
        <span className="shrink-0 rounded-full bg-surface-inset px-2 py-0.5 text-[11px] font-black text-content-muted">{typeLabel}</span>
      </div>
      <p className="mb-3 text-xs font-bold text-content-subtle">응답 {field.answeredCount}건 · 건너뜀 {field.skippedCount}건</p>

      {field.kind === "CHOICE" && (
        <div className="space-y-2.5">
          {field.options.map((option) => (
            <Bar key={option.optionId} label={option.text} count={option.count} total={field.answeredCount} removed={option.removed} />
          ))}
          {field.otherTexts.length > 0 && (
            <div className="mt-2 rounded-xl bg-surface-inset p-3">
              <p className="text-xs font-black text-content-muted">기타 응답 {field.otherTexts.length}건</p>
              <ul className="mt-1.5 space-y-1 text-xs text-content">
                {field.otherTexts.slice(0, 10).map((text, index) => <li key={index} className="truncate">· {text}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {field.kind === "GRID" && (
        <div className="space-y-4">
          {field.rows.map((row) => {
            const rowTotal = row.options.reduce((sum, option) => sum + option.count, 0);
            return (
              <div key={row.rowLabel}>
                <p className="mb-1.5 text-xs font-black text-content">{row.rowLabel}</p>
                <div className="space-y-2 pl-2">
                  {row.options.map((option) => (
                    <Bar key={option.optionId} label={option.text} count={option.count} total={rowTotal} removed={option.removed} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {field.kind === "SCALE" && (
        <div className="space-y-2.5">
          {field.average !== null && <p className="text-sm font-black text-brand">평균 {field.average.toFixed(2)}</p>}
          {field.distribution.map((bucket) => (
            <Bar key={bucket.value} label={String(bucket.value)} count={bucket.count} total={field.answeredCount} />
          ))}
        </div>
      )}

      {field.kind === "TEXT" && (
        field.sampleTexts.length ? (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-surface-inset p-3 text-xs text-content">
            {field.sampleTexts.map((text, index) => <li key={index} className="whitespace-pre-wrap">· {text}</li>)}
          </ul>
        ) : (
          <p className="text-xs text-content-subtle">응답이 없습니다.</p>
        )
      )}

      {field.kind === "VALUE" && (
        field.fieldType === "SIGNATURE" ? (
          <p className="text-xs text-content-subtle">서명은 개별 탭에서 확인할 수 있습니다.</p>
        ) : field.fieldType === "FILE_UPLOAD" ? (
          <p className="text-xs text-content-subtle">파일은 개별 탭에서 확인하고 내려받을 수 있습니다.</p>
        ) : field.sampleValues.length ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl bg-surface-inset p-3 text-xs text-content">
            {field.sampleValues.map((value, index) => <li key={index}>· {value}</li>)}
          </ul>
        ) : (
          <p className="text-xs text-content-subtle">응답이 없습니다.</p>
        )
      )}
    </div>
  );
}

export function IndividualResponses({ formId, page }: { formId: string; page: ResponseListPage }) {
  const [selectedId, setSelectedId] = useState<string | null>(page.items[0]?.id ?? null);
  // detail/error를 selectedId와 짝지어 들고 있습니다 — 다른 응답을 고른 순간 이펙트 안에서
  // 곧바로 setState로 비우면(동기 호출) react-hooks/set-state-in-effect에 걸립니다. 대신
  // "지금 들고 있는 값이 selectedId 것과 같은가"를 렌더에서 비교해, 안 맞으면 로딩으로 봅니다.
  const [detailState, setDetailState] = useState<{ id: string; detail: ResponseDetail } | null>(null);
  const [detailError, setDetailError] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/forms/${formId}/responses/${selectedId}`, { signal: controller.signal })
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        if (!ok) { setDetailError({ id: selectedId, message: typeof data.error === "string" ? data.error : "응답을 불러오지 못했습니다." }); return; }
        setDetailState({ id: selectedId, detail: data.response as ResponseDetail });
      })
      .catch(() => { if (!controller.signal.aborted) setDetailError({ id: selectedId, message: "네트워크 연결을 확인한 뒤 다시 시도해 주세요." }); });
    return () => controller.abort();
  }, [formId, selectedId]);

  const detail = selectedId && detailState?.id === selectedId ? detailState.detail : null;
  const currentDetailError = selectedId && detailError?.id === selectedId ? detailError.message : null;
  return (
    <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
      <div>
        <label className="block sm:hidden">
          <span className="mb-1.5 block text-xs font-black text-content-muted">응답 선택</span>
          <select value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value || null)} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm font-bold text-content">
            {page.items.map((item) => <option key={item.id} value={item.id}>{item.respondentLabel} · {item.submittedAt ? formatDateTime(item.submittedAt) : "제출 시각 없음"}</option>)}
          </select>
        </label>
        <ul className="hidden space-y-1.5 sm:block">
          {page.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${
                  selectedId === item.id ? "border-brand-300 bg-brand-soft/40" : "border-line bg-surface hover:bg-surface-hover"
                }`}
              >
                <p className="truncate font-black text-content">{item.respondentLabel}</p>
                <p className="mt-0.5 text-content-subtle">{item.submittedAt ? formatDateTime(item.submittedAt) : "제출 시각 없음"}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        {currentDetailError ? (
          <InlineNotice tone="error">{currentDetailError}</InlineNotice>
        ) : !selectedId ? (
          <p className="text-sm text-content-subtle">왼쪽에서 응답을 골라 주세요.</p>
        ) : !detail ? (
          <LoadingCard label="응답을 불러오는 중..." />
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-black text-content">{detail.respondentLabel}</p>
              <p className="text-xs text-content-subtle">{detail.submittedAt ? formatDateTime(detail.submittedAt) : "제출 시각 없음"}</p>
            </div>
            {detail.answers.map((answer) => (
              <div key={answer.fieldId} className="rounded-xl border border-line bg-surface p-3">
                <p className="text-xs font-black text-content-muted">{answer.fieldTitle}</p>
                {answer.fieldType === "SIGNATURE" ? (
                  <SignaturePreview
                    strokes={answer.signatureStrokes}
                    downloadUrl={`/api/forms/${formId}/responses/${detail.id}/signatures/${answer.fieldId}`}
                  />
                ) : answer.fieldType === "FILE_UPLOAD" ? (
                  <ul className="mt-2 space-y-1">
                    {answer.files.map((file) => <li key={file.id}><a className="text-sm font-bold text-brand hover:underline" href={`/form-files/${file.id}`}>{file.originalName}</a></li>)}
                  </ul>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm font-bold text-content">
                    {formatAnswerValue(answer) || <span className="font-normal text-content-subtle">(응답 없음)</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SignaturePreview({ strokes, downloadUrl }: { strokes: unknown; downloadUrl: string }) {
  const value = parseSignatureStrokes(strokes);
  if (!value.length) return <p className="mt-1 text-sm text-content-subtle">(서명 없음)</p>;
  const dots = value.flatMap((stroke) => stroke.length === 1 ? stroke : []);
  return (
    <div className="mt-1.5 max-w-xs">
      <div className="relative h-24 w-full overflow-hidden rounded-lg border border-line bg-surface-inset">
        <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <path d={strokesToSvgPath(value, 300, 100)} fill="none" stroke="var(--ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {dots.map((point, index) => <circle key={index} cx={point.x * 300} cy={point.y * 100} r="1.2" fill="var(--ink)" vectorEffect="non-scaling-stroke" />)}
        </svg>
        <PenLine className="absolute bottom-1 right-1 h-3.5 w-3.5 text-content-subtle" aria-hidden />
      </div>
      <a href={downloadUrl} className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-black text-content-muted transition hover:border-brand-300 hover:text-brand">
        <Download className="h-3.5 w-3.5" aria-hidden />SVG 다운로드
      </a>
    </div>
  );
}
