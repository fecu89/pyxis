-- 설문 응답에 응답 시점 스냅샷을 더합니다.
--
-- 설문은 OPEN 중에도 질문 유형·문구를 바꿀 수 있습니다(lib/forms/save.ts). 라이브 FormField를
-- 그대로 따라가면 과거 응답을 지금 정의로 잘못 해석하게 됩니다 — LINEAR_SCALE이던 질문이
-- SHORT_TEXT로 바뀌면 저장된 numberValue를 숫자로 보여줘야 하는지 텍스트로 보여줘야 하는지
-- 판단이 서지 않습니다. 그리드도 마찬가지라 gridValue Json 안의 각 행에 rowLabel을 함께 담기로
-- 했는데, 그건 컬럼이 아니라 JSON 형태 변경이라(lib/forms/field-types.ts) 여기 SQL에는
-- 나타나지 않습니다.
--
-- FormAnswer는 지금 0행입니다 — 공개 제출 API가 아직 없어 응답이 생길 수 없었습니다. 그래서
-- NOT NULL로 바로 추가해도 기존 행 백필이 필요 없습니다.
ALTER TABLE "FormAnswer"
  ADD COLUMN "fieldType" "FormFieldType" NOT NULL,
  ADD COLUMN "fieldTitle" TEXT NOT NULL;
