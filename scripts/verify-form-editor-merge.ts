import assert from "node:assert/strict";
import { duplicateField, type FieldDraft } from "../components/forms/field-model";
import { reconcileSavedFormIdentity } from "../components/forms/reconcile-form-save";

type TestOption = { id?: string; clientId?: string; text: string };
type TestField = { id?: string; clientId: string; title: string; options: TestOption[] };
type TestForm = { updatedAt: string; title: string; fields: TestField[] };

const current: TestForm = {
  updatedAt: "2026-08-15T00:00:00.000Z",
  title: "저장 중에도 고친 제목",
  fields: [
    {
      clientId: "draft-field",
      title: "저장 요청 뒤에 고친 질문",
      options: [{ clientId: "draft-option", text: "저장 요청 뒤에 고친 보기" }],
    },
    {
      clientId: "added-after-request",
      title: "저장 요청 뒤에 추가한 질문",
      options: [],
    },
  ],
};
const saved: TestForm = {
  updatedAt: "2026-08-15T00:00:01.000Z",
  title: "서버에 저장된 이전 제목",
  fields: [
    {
      id: "draft-field",
      clientId: "draft-field",
      title: "서버에 저장된 이전 질문",
      options: [{ id: "draft-option", clientId: "draft-option", text: "서버에 저장된 이전 보기" }],
    },
  ],
};

const reconciled = reconcileSavedFormIdentity(current, saved);
assert.equal(reconciled.updatedAt, saved.updatedAt, "다음 저장이 충돌하지 않도록 서버 문서 버전을 받아야 합니다.");
assert.equal(reconciled.title, current.title, "저장 요청 뒤의 제목 편집을 덮어쓰면 안 됩니다.");
assert.equal(reconciled.fields[0].title, current.fields[0].title, "저장 요청 뒤의 질문 편집을 덮어쓰면 안 됩니다.");
assert.equal(reconciled.fields[0].id, "draft-field", "저장된 새 질문의 영속 ID를 합쳐야 합니다.");
assert.equal(reconciled.fields[0].options[0].id, "draft-option", "저장된 새 보기의 영속 ID를 합쳐야 합니다.");
assert.equal(reconciled.fields[1].id, undefined, "저장 요청 뒤에 추가한 질문은 아직 새 질문이어야 합니다.");
assert.equal(reconciled.fields.length, 2, "저장 요청 뒤에 추가한 질문이 사라지면 안 됩니다.");

const branchingField = {
  id: "field-original",
  clientId: "field-original",
  type: "MULTIPLE_CHOICE",
  title: "분기 질문",
  description: "",
  required: false,
  options: [
    { id: "option-a", clientId: "option-a", text: "A" },
    { id: "option-b", clientId: "option-b", text: "B" },
  ],
  shuffleOptions: false,
  allowOther: false,
  gridRows: [],
  gridRequireOneResponsePerRow: false,
  scaleMin: 1,
  scaleMax: 5,
  scaleMinLabel: "",
  scaleMaxLabel: "",
  ratingMax: 5,
  ratingIcon: "STAR",
  includeYear: true,
  includeTime: false,
  durationMode: false,
  validation: null,
  branchRules: [{ optionId: "option-a", destination: "section-later" }],
  fileMaxCount: 1,
  fileMaxSizeMb: 10,
  fileAllowedTypes: ["IMAGE"],
} satisfies FieldDraft;
const duplicated = duplicateField(branchingField);
assert.notEqual(duplicated.options[0].clientId, "option-a", "복제한 보기는 새 ID를 가져야 합니다.");
assert.deepEqual(duplicated.branchRules, [], "같은 섹션에 분기 질문이 두 개 생기지 않도록 복제본의 분기는 비워야 합니다.");

console.log("form_editor_merge_checks=passed");
