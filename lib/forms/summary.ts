import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { toPublicAuthorDTO } from "@/lib/users/repository";
import { formatAnswerValue } from "@/lib/forms/answer-format";
import { responseExportName } from "@/lib/forms/export-names";
import {
  allowsOtherOption,
  hasOptions,
  isDisplayOnly,
  isGridType,
  parseGridValue,
  type FormFieldType,
} from "@/lib/forms/field-types";

// 응답 집계입니다. 응답 화면(`/forms/[formId]/responses`)의 "요약"·"질문별" 탭이 이 모양을
// 그대로 읽습니다.
//
// 배열·JSON 답변(복수 선택·그리드)은 단순 groupBy로 정확히 집계할 수 없습니다. 그렇다고 답변
// 전체를 한 배열로 올리면 응답이 쌓이는 만큼 서버 메모리가 커지므로, 고정 크기 페이지를 읽어
// 필드별 카운터와 최대 200개 샘플에 즉시 합칩니다.

const TEXT_SAMPLE_LIMIT = 200;
const SUMMARY_ANSWER_PAGE_SIZE = 500;

export type OptionCount = { optionId: string; text: string; count: number; removed: boolean };

export type FieldSummaryBase = {
  fieldId: string;
  fieldType: FormFieldType;
  title: string;
  answeredCount: number;
  skippedCount: number;
};

export type FieldSummary =
  | (FieldSummaryBase & { kind: "CHOICE"; options: OptionCount[]; otherTexts: string[] })
  | (FieldSummaryBase & { kind: "GRID"; rows: { rowLabel: string; options: OptionCount[] }[] })
  | (FieldSummaryBase & { kind: "SCALE"; average: number | null; distribution: { value: number; count: number }[] })
  | (FieldSummaryBase & { kind: "TEXT"; sampleTexts: string[]; truncated: boolean })
  | (FieldSummaryBase & { kind: "VALUE"; sampleValues: string[]; truncated: boolean });

export type FormSummary = { totalResponses: number; fields: FieldSummary[] };

type RawAnswer = {
  id: string;
  fieldId: string;
  fieldType: FormFieldType;
  fieldTitle: string;
  textValue: string | null;
  selectedOptionIds: string[];
  selectedOptionTexts: string[];
  numberValue: number | null;
  dateValue: Date | null;
  timeValue: string | null;
  gridValue: Prisma.JsonValue;
};

type SnapshotCount = { text: string; count: number };
type AnswerAccumulator = {
  fieldId: string;
  fieldType: FormFieldType;
  fieldTitle: string;
  answeredCount: number;
  selectedOptions: Map<string, SnapshotCount>;
  gridRows: Map<string, Map<string, SnapshotCount>>;
  otherTexts: string[];
  scaleSum: number;
  scaleValueCount: number;
  scaleDistribution: Map<number, number>;
  textSamples: string[];
  textValueCount: number;
  valueSamples: string[];
  valueCount: number;
};

type FieldWithOptions = {
  id: string;
  type: FormFieldType;
  title: string;
  gridRows: string[];
  options: { id: string; text: string }[];
};

export async function buildFormSummary(formId: string): Promise<FormSummary> {
  const prisma = getPrisma();
  const [form, fields] = await Promise.all([
    prisma.form.findUniqueOrThrow({ where: { id: formId }, select: { responseCount: true } }),
    prisma.formField.findMany({
      where: { formId },
      orderBy: { position: "asc" },
      include: { options: { orderBy: { position: "asc" } } },
    }),
  ]);

  const accumulators = new Map<string, Map<FormFieldType, AnswerAccumulator>>();
  let cursor: string | undefined;
  do {
    const answers = await prisma.formAnswer.findMany({
      where: { field: { formId } },
      orderBy: { id: "asc" },
      take: SUMMARY_ANSWER_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        fieldId: true,
        fieldType: true,
        fieldTitle: true,
        textValue: true,
        selectedOptionIds: true,
        selectedOptionTexts: true,
        numberValue: true,
        dateValue: true,
        timeValue: true,
        gridValue: true,
      },
    });
    for (const answer of answers) accumulateAnswer(accumulators, answer);
    cursor = answers.length === SUMMARY_ANSWER_PAGE_SIZE ? answers.at(-1)?.id : undefined;
  } while (cursor);

  const totalResponses = form.responseCount;
  const summaries = fields
    .filter((field) => !isDisplayOnly(field.type))
    .flatMap((field) => summariesForField(field, accumulators.get(field.id), totalResponses));

  return { totalResponses, fields: summaries };
}

/** OPEN 설문에서 유형을 바꾸면 한 fieldId 아래에 서로 다른 형태의 답이 함께 남습니다. 현재
 * 유형으로 전부 해석하지 않고 현재 카드와 이전 유형 카드를 나눠 각 스냅샷 형태로 집계합니다. */
function summariesForField(field: FieldWithOptions, byType: Map<FormFieldType, AnswerAccumulator> | undefined, totalResponses: number): FieldSummary[] {
  const result = [summarizeField(field, byType?.get(field.type), totalResponses)];
  for (const [type, accumulator] of byType ?? []) {
    if (type === field.type || isDisplayOnly(type)) continue;
    const optionById = new Map<string, string>();
    for (const [id, snapshot] of accumulator.selectedOptions) optionById.set(id, snapshot.text);
    for (const options of accumulator.gridRows.values()) {
      for (const [id, snapshot] of options) optionById.set(id, snapshot.text);
    }
    const historicalField: FieldWithOptions = {
      id: `${field.id}:history:${type}`,
      type,
      title: `${accumulator.fieldTitle || field.title} (이전 유형)`,
      gridRows: [...accumulator.gridRows.keys()],
      options: [...optionById].map(([id, text]) => ({ id, text })),
    };
    result.push(summarizeField(historicalField, accumulator, totalResponses));
  }
  return result;
}

function summarizeField(field: FieldWithOptions, accumulator: AnswerAccumulator | undefined, totalResponses: number): FieldSummary {
  const answeredCount = accumulator?.answeredCount ?? 0;
  const base: FieldSummaryBase = {
    fieldId: field.id,
    fieldType: field.type,
    title: field.title,
    answeredCount,
    skippedCount: Math.max(0, totalResponses - answeredCount),
  };

  if (isGridType(field.type)) return { ...base, kind: "GRID", rows: summarizeGrid(field, accumulator) };
  if (hasOptions(field.type)) return { ...base, kind: "CHOICE", ...summarizeChoice(field, accumulator) };
  if (field.type === "LINEAR_SCALE" || field.type === "RATING") return { ...base, kind: "SCALE", ...summarizeScale(accumulator) };
  if (field.type === "SHORT_TEXT" || field.type === "LONG_TEXT") return { ...base, kind: "TEXT", sampleTexts: accumulator?.textSamples ?? [], truncated: (accumulator?.textValueCount ?? 0) > TEXT_SAMPLE_LIMIT };
  return { ...base, kind: "VALUE", sampleValues: field.type === "SIGNATURE" ? [] : accumulator?.valueSamples ?? [], truncated: field.type === "SIGNATURE" ? false : (accumulator?.valueCount ?? 0) > TEXT_SAMPLE_LIMIT };
}

/** 답이 가리키는 보기가 이미 지워졌으면(save.ts는 응답이 있어도 보기 삭제를 막지 않습니다)
 * 그 순간의 스냅샷 문구로 "지워진 보기" 버킷을 새로 만들어 응답이 조용히 사라지지 않게 합니다. */
function bucketOption(counts: Map<string, OptionCount>, optionId: string, snapshotText: string | undefined, increment = 1) {
  const existing = counts.get(optionId);
  if (existing) {
    existing.count += increment;
    return;
  }
  const key = `removed:${optionId}`;
  const removed = counts.get(key) ?? { optionId: key, text: snapshotText ?? "(지워진 보기)", count: 0, removed: true };
  removed.count += increment;
  counts.set(key, removed);
}

function summarizeChoice(field: FieldWithOptions, accumulator: AnswerAccumulator | undefined) {
  const counts = new Map<string, OptionCount>(
    field.options.map((option) => [option.id, { optionId: option.id, text: option.text, count: 0, removed: false }]),
  );
  for (const [optionId, snapshot] of accumulator?.selectedOptions ?? []) bucketOption(counts, optionId, snapshot.text, snapshot.count);
  return { options: [...counts.values()], otherTexts: allowsOtherOption(field.type) ? accumulator?.otherTexts ?? [] : [] };
}

function summarizeGrid(field: FieldWithOptions, accumulator: AnswerAccumulator | undefined) {
  // 행에는 안정된 ID가 없습니다(gridRows는 문자열 배열). 지금 행 이름을 기준으로 자리를 먼저
  // 만들고, 이제는 없는(지워졌거나 이름이 바뀐) 행의 과거 응답은 그때 라벨로 따로 모읍니다.
  const rows = new Map<string, Map<string, OptionCount>>();
  function bucketFor(label: string) {
    let bucket = rows.get(label);
    if (!bucket) {
      bucket = new Map(field.options.map((option) => [option.id, { optionId: option.id, text: option.text, count: 0, removed: false }]));
      rows.set(label, bucket);
    }
    return bucket;
  }
  for (const label of field.gridRows) bucketFor(label); // 응답이 없는 현재 행도 0으로 보여야 합니다.
  for (const [rowLabel, selectedOptions] of accumulator?.gridRows ?? []) {
    const bucket = bucketFor(rowLabel);
    for (const [optionId, snapshot] of selectedOptions) bucketOption(bucket, optionId, snapshot.text, snapshot.count);
  }
  return [...rows.entries()].map(([rowLabel, options]) => ({ rowLabel, options: [...options.values()] }));
}

function summarizeScale(accumulator: AnswerAccumulator | undefined) {
  const count = accumulator?.scaleValueCount ?? 0;
  return {
    average: count ? (accumulator?.scaleSum ?? 0) / count : null,
    distribution: [...(accumulator?.scaleDistribution ?? [])].sort((a, b) => a[0] - b[0]).map(([value, bucketCount]) => ({ value, count: bucketCount })),
  };
}

function accumulateAnswer(all: Map<string, Map<FormFieldType, AnswerAccumulator>>, answer: RawAnswer) {
  let byType = all.get(answer.fieldId);
  if (!byType) {
    byType = new Map();
    all.set(answer.fieldId, byType);
  }
  let accumulator = byType.get(answer.fieldType);
  if (!accumulator) {
    accumulator = {
      fieldId: answer.fieldId,
      fieldType: answer.fieldType,
      fieldTitle: answer.fieldTitle,
      answeredCount: 0,
      selectedOptions: new Map(),
      gridRows: new Map(),
      otherTexts: [],
      scaleSum: 0,
      scaleValueCount: 0,
      scaleDistribution: new Map(),
      textSamples: [],
      textValueCount: 0,
      valueSamples: [],
      valueCount: 0,
    };
    byType.set(answer.fieldType, accumulator);
  }
  accumulator.answeredCount += 1;

  answer.selectedOptionIds.forEach((optionId, index) => incrementSnapshot(accumulator!.selectedOptions, optionId, answer.selectedOptionTexts[index]));
  if (allowsOtherOption(answer.fieldType) && answer.textValue && accumulator.otherTexts.length < TEXT_SAMPLE_LIMIT) accumulator.otherTexts.push(answer.textValue);
  for (const row of parseGridValue(answer.gridValue)) {
    let options = accumulator.gridRows.get(row.rowLabel);
    if (!options) {
      options = new Map();
      accumulator.gridRows.set(row.rowLabel, options);
    }
    row.optionIds.forEach((optionId, index) => incrementSnapshot(options!, optionId, row.optionTexts[index]));
  }
  if (answer.numberValue !== null) {
    accumulator.scaleSum += answer.numberValue;
    accumulator.scaleValueCount += 1;
    accumulator.scaleDistribution.set(answer.numberValue, (accumulator.scaleDistribution.get(answer.numberValue) ?? 0) + 1);
  }
  if ((answer.fieldType === "SHORT_TEXT" || answer.fieldType === "LONG_TEXT") && answer.textValue) {
    accumulator.textValueCount += 1;
    if (accumulator.textSamples.length < TEXT_SAMPLE_LIMIT) accumulator.textSamples.push(answer.textValue);
  }
  const value = answer.fieldType === "DATE" ? answer.dateValue?.toISOString() ?? answer.timeValue : answer.timeValue;
  if (value) {
    accumulator.valueCount += 1;
    if (accumulator.valueSamples.length < TEXT_SAMPLE_LIMIT) accumulator.valueSamples.push(value);
  }
}

function incrementSnapshot(counts: Map<string, SnapshotCount>, id: string, text: string | undefined) {
  const current = counts.get(id);
  if (current) current.count += 1;
  else counts.set(id, { text: text ?? "(이전 보기)", count: 1 });
}

// ── 개별 응답 ─────────────────────────────────────────────────────────────────
// "개별" 탭은 응답이 쌓일수록 커지므로 요약과 달리 페이지네이션이 필요합니다.

export const RESPONSES_PAGE_SIZE = 20;

export type ResponseListItem = {
  id: string;
  respondentLabel: string;
  submittedAt: string | null;
  answeredCount: number;
};

/** 익명이면 "익명 N"(순번 없으면 그냥 "익명 응답"), 이름을 물었으면 그 이름, 로그인 응답이면 복호화한 실명. */
export function respondentLabel(
  index: number | null,
  response: { respondentName: string | null; respondent: { id: string; nameEncrypted: string | null; imageEncrypted: string | null } | null },
): string {
  if (response.respondentName) return response.respondentName;
  if (response.respondent) return toPublicAuthorDTO(response.respondent).name ?? "이름 없음";
  return index ? `익명 응답 ${index}` : "익명 응답";
}

export async function listFormResponses(formId: string, page: number): Promise<{ items: ResponseListItem[]; totalCount: number; page: number; pageSize: number }> {
  const prisma = getPrisma();
  const pageSize = RESPONSES_PAGE_SIZE;
  const [totalCount, rows] = await Promise.all([
    prisma.formResponse.count({ where: { formId } }),
    prisma.formResponse.findMany({
      where: { formId },
      orderBy: { submittedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        respondentName: true,
        submittedAt: true,
        respondent: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
        _count: { select: { answers: true } },
      },
    }),
  ]);
  // 익명 번호는 전체 목록에서의 제출 순서입니다(오래된 것부터 1번) — 페이지가 바뀌어도
  // 같은 응답이 같은 번호를 유지해야 하므로 totalCount에서 역산합니다.
  const items = rows.map((row, index) => ({
    id: row.id,
    respondentLabel: respondentLabel(totalCount - ((page - 1) * pageSize + index), row),
    submittedAt: row.submittedAt?.toISOString() ?? null,
    answeredCount: row._count.answers,
  }));
  return { items, totalCount, page, pageSize };
}

export type ResponseAnswerDetail = {
  fieldId: string;
  fieldType: FormFieldType;
  fieldTitle: string;
  textValue: string | null;
  selectedOptionTexts: string[];
  numberValue: number | null;
  dateValue: string | null;
  timeValue: string | null;
  gridValue: Prisma.JsonValue;
  signatureStrokes: Prisma.JsonValue;
  files: Array<{ id: string; originalName: string }>;
};

export type ResponseDetail = {
  id: string;
  respondentLabel: string;
  submittedAt: string | null;
  answers: ResponseAnswerDetail[];
};

/** `formId`를 함께 받아 다른 설문의 응답 ID를 넣어도 못 보게 합니다(권한 확인은 라우트가 하지만, 여기서도 formId로 한 번 더 좁힙니다). */
export async function getFormResponseDetail(formId: string, responseId: string): Promise<ResponseDetail | null> {
  const response = await getPrisma().formResponse.findFirst({
    where: { id: responseId, formId },
    select: {
      id: true,
      respondentName: true,
      submittedAt: true,
      respondent: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      answers: {
        // 필드 자체의 현재 position이 아니라 응답 시점 스냅샷 순서를 보여줘도 되지만, 안정된
        // 정렬 기준이 필요해 응답이 만들어진 순서(= 그 시점 필드 순서)로 둡니다.
        orderBy: { answeredAt: "asc" },
        select: {
          fieldId: true, fieldType: true, fieldTitle: true, textValue: true, selectedOptionTexts: true,
          numberValue: true, dateValue: true, timeValue: true, gridValue: true, signatureStrokes: true,
          files: { where: { deletedAt: null }, select: { id: true, originalName: true } },
        },
      },
    },
  });
  if (!response) return null;
  return {
    id: response.id,
    respondentLabel: respondentLabel(null, response), // 상세 화면에서는 순번이 필요 없습니다.
    submittedAt: response.submittedAt?.toISOString() ?? null,
    answers: response.answers.map((answer) => ({
      fieldId: answer.fieldId,
      fieldType: answer.fieldType,
      fieldTitle: answer.fieldTitle,
      textValue: answer.textValue,
      selectedOptionTexts: answer.selectedOptionTexts,
      numberValue: answer.numberValue,
      dateValue: answer.dateValue?.toISOString() ?? null,
      timeValue: answer.timeValue,
      gridValue: answer.gridValue,
      signatureStrokes: answer.signatureStrokes,
      files: answer.files,
    })),
  };
}

// ── XLSX 내보내기 ─────────────────────────────────────────────────────────────
// "개별" 탭과 같은 `formatAnswerValue`를 써서, 화면에서 보는 값과 파일로 받는 값이 어긋나지
// 않습니다. 목록(listFormResponses)과 달리 페이지네이션이 없습니다 — 내보내기는 전체가
// 목적이라 자르면 오히려 틀린 결과입니다.

export type FormExportData = {
  formTitle: string;
  fieldTitles: string[];
  rows: Array<{ respondentLabel: string; submittedAt: string | null; values: string[] }>;
};

export async function gatherFormExportData(formId: string): Promise<FormExportData> {
  const prisma = getPrisma();
  const [form, fields, responses] = await Promise.all([
    prisma.form.findUniqueOrThrow({ where: { id: formId }, select: { title: true } }),
    prisma.formField.findMany({ where: { formId }, orderBy: { position: "asc" }, select: { id: true, type: true, title: true } }),
    prisma.formResponse.findMany({
      where: { formId },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        respondentName: true,
        submittedAt: true,
        respondent: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
        answers: {
          select: {
            fieldId: true, fieldType: true, textValue: true, selectedOptionTexts: true,
            numberValue: true, dateValue: true, timeValue: true, gridValue: true,
            files: { where: { deletedAt: null }, select: { originalName: true } },
          },
        },
      },
    }),
  ]);

  const questionFields = fields.filter((field) => !isDisplayOnly(field.type));
  const rows = responses.map((response, index) => {
    const answerByField = new Map(response.answers.map((answer) => [answer.fieldId, answer]));
    return {
      respondentLabel: responseExportName(respondentLabel(index + 1, response), response.id),
      submittedAt: response.submittedAt?.toISOString() ?? null,
      values: questionFields.map((field) => {
        const answer = answerByField.get(field.id);
        if (!answer) return "";
        return formatAnswerValue({
          fieldType: answer.fieldType,
          textValue: answer.textValue,
          selectedOptionTexts: answer.selectedOptionTexts,
          numberValue: answer.numberValue,
          dateValue: answer.dateValue?.toISOString() ?? null,
          timeValue: answer.timeValue,
          gridValue: answer.gridValue,
          files: answer.files,
        });
      }),
    };
  });

  return { formTitle: form.title, fieldTitles: questionFields.map((field) => field.title), rows };
}
