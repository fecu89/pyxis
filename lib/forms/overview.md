# lib/forms 개요

구글 설문지에 해당하는 설문 도메인의 공용 계층입니다. 서명 필드가 더해져 있습니다.

퀴즈의 참여형 문항(`SURVEY`·`LIKERT`)으로 대신하지 않고 도메인을 나눈 이유 — 그쪽은 교사가 세션을 열고 학생이 PIN으로 들어와 실시간으로 진행하는 동안에만 동작합니다. 학부모 동의서나 수요 조사처럼 링크를 뿌려 두고 며칠에 걸쳐 받는 요구는 그 구조로 표현되지 않습니다.

## `server-only`를 붙이지 않는 파일들

응답 확인과 서명 검증은 **화면과 제출 API가 같은 코드**를 써야 합니다. 화면에서만 막고 서버가 다시 안 보면 브라우저 검사를 우회한 값이 그대로 저장되고, 반대로 규칙을 두 곳에 손으로 적으면 한쪽만 고쳐져서 "화면에서는 통과했는데 제출이 거부되는" 상태가 됩니다. 퀴즈의 `questionCompletionError`가 편집기와 `lib/quiz/question-schema.ts` 양쪽에 중복돼 있는 것이 그 실수의 실제 사례입니다.

- `field-types.ts`: 유형 상수·상한·유형 판정(`hasOptions`·`isGridType`·`acceptsValidation` 등)과 그리드 응답 형태. `field-schema.ts`와 `validation.ts`가 서로를 import하면 순환이 되므로 공통 어휘만 여기 모읍니다. "이 유형이 보기를 가지는가"를 화면마다 나열하면 유형을 추가할 때 빠뜨리는 곳이 반드시 생깁니다. `FormClosedReason`·`FORM_CLOSED_MESSAGES`·`formClosedReason()`·`formClosedMessage()`도 여기 있습니다 — 원래 `access.ts`에 있었는데, 응답 화면(`form-runner.tsx`, 클라이언트 컴포넌트)이 이걸 import하자 번들러가 `access.ts`를 따라 `prisma`·`pg`까지 브라우저 번들에 끌어들이려다 `yarn build`가 실제로 깨졌습니다(`node:tls` 모듈을 못 찾음). `server-only` 패키지는 클라이언트 컴포넌트가 **직접** import할 때만 친절한 에러를 주지, 이렇게 몇 단계 건너 딸려 들어가는 경우는 번들러의 module-not-found로만 드러납니다.
- `validation.ts`: **`validateAnswer(field, answer)`가 응답 검사의 정본입니다.** 필수 여부 → 유형에 맞는 형태 → 응답 확인 규칙 순으로 봅니다. 순서가 중요한데, 비어 있는데 규칙부터 돌리면 선택 안 한 칸에 "숫자를 입력해 주세요"가 뜹니다. 정규식 규칙은 패턴 200자 상한 + 검사 대상 문자열을 200자로 자른 뒤 실행합니다 — 길이 상한만으로는 `(a+)+$` 같은 게 막히지 않는데 입력이 짧으면 그런 패턴도 금방 끝납니다. 패턴이 깨졌으면 통과시킵니다: 작성자의 실수 때문에 응답자가 영영 제출하지 못하는 쪽이 더 나쁩니다.
- `field-schema.ts`: 편집기가 보내는 전체 문서의 zod 스키마와 발행 전 완성도 검사(`fieldCompletionError`·`formCompletionError`). 저장은 필드 단위가 아니라 문서 통째로 PUT입니다 — 순서 바꾸기·유형 전환·보기 추가가 한 편집에 뒤섞이는데 필드별 요청으로 쪼개면 중간에 실패했을 때 화면과 DB가 서로 다른 상태로 남습니다.
- `signature.ts`: 서명의 좌표계. `signature_pad`의 CSS 픽셀을 0~1로 정규화하고 압력·상대 시간을 보존하며, 저장 직전 소수 셋째 자리로 양자화합니다. 기존 `{x,y}` 획도 계속 읽습니다.
- `guest-access.ts`: 익명 응답자의 신원. 쿠키 `form_guest_{formId}`, 토큰 원문은 저장하지 않고 sha256만. `dedupeKeyFor()`가 1인 1응답의 열쇠를 만듭니다.

## 서명을 이미지가 아니라 좌표로 저장하는 이유

응답마다 파일이 생기면 저장소 한도·미참조 파일 정리 스위퍼·열람 권한 검사가 전부 새로 필요합니다(퀴즈 이미지에 그 셋을 붙인 코드가 `image-store.ts` 228줄 + `image-maintenance.ts` 85줄 + `image-sweep.ts` 125줄 + `image-access.ts` 68줄입니다). 벡터는 확대해도 깨지지 않아 인쇄에 유리하고, 서명은 인쇄되는 것이 목적입니다. 서명 하나는 보통 수 KB입니다. `Question.pinAreas`가 이미 같은 방식으로 좌표를 Json에 담고 있습니다.

XLSX·PDF에 래스터가 필요해지면 그때 서버에서 SVG를 PNG로 구우면 되고, 저장 형식은 바꾸지 않아도 됩니다.

## 1인 1응답은 응용 코드가 아니라 DB가 막습니다

`FormResponse.dedupeKey` + `@@unique([formId, dedupeKey])` 하나가 두 정책을 다 표현합니다. `allowMultipleResponses`가 false일 때만 `u:{respondentId}` 또는 `g:{guestTokenHash}`를 넣고, true면 null을 넣습니다 — PostgreSQL이 유니크 인덱스에서 null을 서로 다른 값으로 보기 때문입니다.

`@@unique([formId, respondentId])`로 하면 복수 응답 허용을 표현할 수 없고, 응용 코드의 "조회했더니 없어서 만들었다"는 두 요청이 동시에 오면 둘 다 통과합니다. 설문 링크는 단톡방에 뿌려지므로 실제로 동시에 옵니다.

## 설문을 지울 때는 답변을 먼저 지웁니다

`FormAnswer.fieldId`가 `RESTRICT`라(응답이 달린 질문을 실수로 못 지우게 하려는 것) 활동만 지우면 `Activity → Form → FormField` cascade가 그 제약에 걸려 **통째로 실패합니다**(P2003). 응답 쪽 cascade(`FormResponse → FormAnswer`)가 먼저 끝난다는 보장이 없습니다. 실제로 확인한 동작이고 `scripts/verify-forms-schema.ts`의 `checkDeleteOrder`가 이 순서 요구를 붙잡아 둡니다.

순서:

```ts
await tx.formAnswer.deleteMany({ where: { field: { formId } } });
await tx.activity.delete({ where: { id: activityId } }); // Form·질문·응답이 함께 내려갑니다
```

검증 스크립트는 `scripts/fixtures.ts`의 `deleteFormFixture()`를 씁니다. 영구 삭제 경로도 같은 순서를 따라야 합니다.

## `server-only` 파일들

- `access.ts`: `getFormAccess(formId, actor)` → `OWNER`/`EDITOR`/`VIEWER`와 `requireViewableForm`·`requireManageableForm`·`requireOwnedForm`. 퀴즈와 다른 점 하나 — 퀴즈에는 "검색 공개"가 있어 남의 퀴즈도 열람·복제할 수 있지만 **설문에는 그 통로를 두지 않았습니다.** 응답에 개인정보가 담깁니다. 공개 주소용 `createFormSlug()`와, 지금 응답을 받을 수 있는지 **이유와 함께** 답하는 `formClosedReason()`도 여기 있습니다(응답자에게 "열 수 없습니다"만 보여 주면 기다려야 하는지 끝난 것인지 알 수 없습니다). `shouldClearCloseAt()`은 발행할 때 예약 마감을 지울지 판정하는 순수 함수 — 아래 "발행이 마감 예약을 지우는 조건" 참고.
- `list.ts`: `/forms` 서버 렌더링용 목록. 세션 사용자의 소유·공유 범위를 적용하고 상태별 개수와 현재 페이지 20개만 읽습니다. 목록 API를 다시 호출하지 않습니다. "전체 조회" 판정은 admin "전체 설문" 탭과 같은 `canViewAllQuizzes`(VIEW_ALL_QUIZZES 또는 EDIT_ANY_QUIZ)입니다 — `access.ts`가 EDIT_ANY_QUIZ 보유자에게 개별 설문 OWNER 접근을 이미 주므로 목록만 좁힐 이유가 없습니다.
- `admin-queries.ts`: `getAdminFormPage()` — 관리자 센터 "전체 설문" 탭 전용. `list.ts`의 `getFormListPage`(본인 서재용, view·status 필터와 상태별 사이드바 카운트)와 달리 `lib/quiz/admin-queries.ts`의 `getAdminQuizPage`처럼 검색·소유자 정확 검색·수정일 범위·보관 토글·정렬만 받는 얇은 skip/take 페이지네이션입니다.
- `shares.ts`: 공유 목록·후보 조회(`listFormShares`)와 부여·회수(`upsertFormShare`·`removeFormShare`). 후보와 POST 대상 검증은 `lib/users/share-scope.ts`의 `teacherShareCandidateScope`(같은 학교, VIEW_USERS면 전체 — 퀴즈 공유 라우트와 같은 함수)로 좁히되, 이미 share 행이 있는 대상은 scope 밖이어도 업서트를 허용합니다(후보 축소 이전에 맺어진 학교 밖 공유의 권한 변경이 막히면 안 됩니다). 범위 밖도 같은 "찾을 수 없음"(`ShareTargetError`)으로 응답해 존재 여부를 흘리지 않습니다.
- `save.ts`: 편집기의 전체 문서 저장. 아래 참고.
- `option-bulk-update.ts`: 보기 여러 건을 `UPDATE … FROM (VALUES …)` 한 번으로 갱신합니다. 지우고 다시 만들지 않는 이유는 **ID를 보존**해야 그 보기를 고른 과거 응답의 집계가 살아남기 때문이고, 한 번에 묶는 이유는 20문항 × 5보기면 update가 100번 날아가 인터랙티브 트랜잭션 5초 제한에 실제로 걸리기 때문입니다.

## 슬러그를 제목에서 만들지 않습니다

`createFormSlug()`는 무작위입니다. 한글 제목은 슬러그가 되지 않아 어차피 음차가 필요하고, 무엇보다 제목을 넣으면 `/s/3학년-2반-상담-신청` 같은 주소가 링크를 받은 사람 모두에게 내용을 알려 줍니다. 설문 링크는 단톡방에 그대로 붙습니다. 0/O, 1/l을 뺀 문자만 써서 손으로 옮겨 적을 때 헷갈리지 않게 합니다.

## 저장은 문서 통째로 (`save.ts`)

규칙 넷:

1. 요청의 ID 집합이 현재 문서와 정확히 일치하지 않으면 **저장 전체를 거부**합니다. 부분 적용보다 거부가 낫습니다 — 편집기가 낡았다는 뜻이라 새로고침을 시켜야 합니다.
2. 유형에 안 맞는 열은 **명시적으로 초기화**합니다. 척도였던 질문을 단답형으로 바꿔도 `scaleMin`이 남으면, 나중에 다시 척도로 바꿨을 때 예전 눈금이 되살아나고 집계가 조용히 틀립니다.
3. 보기는 지우고 다시 만들지 않고 ID를 보존한 채 갱신합니다.
4. 저장은 `status`를 건드리지 않습니다. `OPEN` 상태에서도 질문 추가·수정·삭제가 가능하며, 기존 답변이 달린 질문 삭제만 명시적 확인 뒤 해당 답변과 함께 처리합니다.
5. `expectedUpdatedAt`이 왔는데 실제 `Form.updatedAt`과 다르면 거부합니다(아래 "낙관적 동시성" 참고).

응답이 달린 질문을 지우려 하면 `DestructiveSaveError`를 던지고, 라우트가 409 + 응답 건수로 바꿔 편집기가 되묻게 합니다. 다른 곳이 먼저 저장했으면 `ConflictSaveError`를 던지고, 라우트가 409 + `needsReload`로 바꿉니다.

## 낙관적 동시성 — 새 컬럼 없이 `updatedAt`으로

`useDocumentSave`의 `isCurrent()`(`lib/editor/use-document-save.ts`)는 **같은 탭 안의** 편집만 보호합니다. 다른 탭이나 공유받은 EDITOR가 그 사이에 먼저 저장한 문서를, 낡은 화면을 든 세션이 "지금 화면 그대로"로 덮어쓰는 것은 막지 못합니다.

그래서 편집기가 문서를 불러온 시점의 `Form.updatedAt`을 `expectedUpdatedAt`으로 저장 요청에 실어 보냅니다. `saveFormDocument`가 트랜잭션에서 Form 행을 `FOR UPDATE`로 먼저 잠근 뒤 실제 `updatedAt`과 비교해 다르면 아무것도 반영하지 않고 `ConflictSaveError`를 던집니다. 잠금 없이 조회 후 비교만 하면 동시에 시작한 두 저장이 같은 값을 읽고 둘 다 통과할 수 있습니다. `Form.version` 같은 전용 컬럼을 새로 만들지 않은 이유 — `updatedAt`은 이미 있고, 문서 저장마다 자동으로 갱신되므로 그대로 버전 토큰으로 씁니다. 응답 제출의 `responseCount` 증가는 raw SQL로 처리해 이 문서 버전을 바꾸지 않습니다.

`expectedUpdatedAt`은 스키마에서 `optional()`입니다. 검증 스크립트가 `saveFormDocument`를 직접 부를 때마다 이 값을 채우지 않아도 되게 하려는 것이고, 실제 편집기는 항상 채워 보내므로 보호는 그대로 유효합니다.

## 발행이 마감 예약을 지우는 조건

`shouldClearCloseAt(closeAt, now)`가 정본입니다. **이미 지난 마감만 지웁니다.** 무조건 지우면(예전 동작) 첫 발행(`DRAFT → OPEN`)에서 미리 설정한 미래의 예약 마감이 발행하자마자 사라지고, 무조건 안 지우면 지난 마감으로 닫혔던 설문을 다시 열어도(`CLOSED → OPEN`) `formClosedReason()`이 곧바로 `PAST_DUE`로 되돌려 재개가 안 됩니다. 상태(DRAFT였는지 CLOSED였는지)로 분기하지 않고 `closeAt`이 미래인지만 보는 이유는, 그 판정 하나로 두 상황을 모두 올바르게 처리하기 때문입니다.

## 응답 확인이 보기 ID까지 봅니다

`validateAnswer`(`lib/forms/validation.ts`)는 객관식·드롭다운의 단일 선택 개수만 보던 것에서, **선택한 ID가 실제 이 질문의 보기인지, 중복은 없는지**까지 봅니다(`ValidatableField.optionIds` + `checkSelectedOptionIds()`). 그리드도 열이 곧 보기라 같은 검사를 받습니다.

CHECKBOXES는 예전에 `checkShape()`의 어느 분기와도 맞지 않아 **shape 검사 자체가 빠져 있었습니다** — 지워진 보기나 다른 질문의 ID를 골랐다고 보내도 그냥 통과했다는 뜻입니다. 지금은 명시적으로 `checkSelectedOptionIds()`를 부릅니다.

정규식 응답 확인은 패턴 길이(200자)·검사 문자열 길이(200자) 상한만으로는 `(a+)+$` 같은 중첩 수량자를 못 막습니다 — 200자여도 사실상 무한 시간입니다. `safeRegexTest`가 실행 전에 패턴 모양을 보는 정적 휴리스틱(`CATASTROPHIC_REGEX_SHAPE`)으로 걸러 아예 실행하지 않습니다. 모든 위험 패턴을 잡는 건 아니지만(예: 얼터네이션 기반 ReDoS는 못 잡습니다), 새 의존성 없이 흔한 실수는 막습니다. 걸러진 패턴은 "판정 불가"와 같은 취급으로 통과시킵니다 — 작성자의 실수 때문에 응답자가 영영 제출 못 하는 쪽이 더 나쁩니다.

## 제출은 `submit.ts` — 응답 시점 스냅샷을 서버가 직접 채웁니다

`response-schema.ts`(클라이언트도 import하는 wire 스키마)는 `selectedOptionTexts`·`gridValue[].rowLabel`·`fieldType`·`fieldTitle`을 **받지 않습니다.** OPEN 설문은 응답을 받는 도중에도 질문을 고칠 수 있으므로(위 "저장은 문서 통째로" 4번), 클라이언트가 스냅샷 텍스트를 같이 보내면 그 시점 이후의 질문 편집과 뒤섞여 신뢰할 수 없습니다. 대신 `submit.ts`의 `buildAnswerCreate()`가 제출 **그 순간의** `FormField`·`FormFieldOption`(트랜잭션 안에서 읽은 값)에서 직접 채웁니다. 질문 제목을 나중에 고쳐도 이미 낸 응답은 제출 당시의 제목·유형·보기 텍스트를 그대로 간직합니다.

정원(`maxResponses`)은 "세어보고 비었으면 만든다"로는 동시 제출을 못 막습니다(마지막 한 자리를 두고 요청 두 개가 동시에 오면 둘 다 통과). 대신 raw SQL의 조건부 UPDATE에 OPEN 상태·삭제 여부·시작/마감 시각·현재 정원 판정과 `responseCount + 1`을 **한 문장**으로 묶습니다. PostgreSQL이 이 행을 잠그므로 동시에 온 두 요청 중 하나만 자리를 얻고, 조회 직후 설문이 마감되는 경합도 통과하지 않습니다. raw SQL인 이유는 응답 수만 바뀔 때 편집 문서 버전인 `updatedAt`을 갱신하지 않기 위해서이기도 합니다. `scripts/verify-forms-submit.ts`의 `checkCapacityRace`가 `Promise.all`로 실제 동시 요청을 쏘아 확인합니다.

수정 화면은 `canEdit`만 받지 않습니다. 공개 정의 API가 로그인 계정 또는 설문별 게스트 쿠키로 본인 응답을 찾고 `existingAnswers`를 함께 내려줘 기존 값을 먼저 채웁니다. 현재 질문과 유형이 다르거나 삭제된 보기·이름이 바뀐 그리드 행은 지금 질문의 답으로 오인하지 않도록 복원하지 않습니다.

공개 제출 본문은 스트림을 읽는 동안 3MB에서 중단하고, 답변 맵은 최대 200개이며 실제 설문에 없는 질문 ID를 허용하지 않습니다. 날짜는 설정별 형식을 엄격히 검사합니다. 연도 없는 날짜는 임의 연도를 만들지 않고 `timeValue` 문자열 칸에 `MM-DD` 또는 `MM-DDTHH:mm`으로 보존합니다.

1인 1응답은 위 "1인 1응답은 응용 코드가 아니라 DB가 막습니다"의 `dedupeKey` 유니크 제약을 그대로 씁니다. `isDedupeConflict()`가 P2002를 잡아 `DuplicateResponseError`로 바꾸는데, **`@prisma/adapter-pg`(드라이버 어댑터) 아래서는 `error.meta.target`이 채워지지 않습니다** — `{ modelName, driverAdapterError }`만 옵니다. 전통적인 쿼리 엔진을 가정하고 `error.meta.target`을 읽는 `lib/users/nickname.ts`의 `isNicknameUniqueConflict`나 `app/api/admin/users/[userId]/route.ts`의 인라인 검사는 이 프로젝트의 실제 Prisma 구성에서는 안 걸릴 가능성이 있습니다(직접 재현해 확인한 사실이고, 이번엔 forms 바깥은 손대지 않았습니다). `isDedupeConflict()`는 `target`이 배열/문자열이면 그걸 보고, 없으면 `meta.modelName === "FormResponse"`로 대체 판정합니다.

수정(`updateFormResponse`)은 응답을 지우고 다시 만드는 대신 기존 답변을 지우고 새로 채웁니다(응답 id·`submittedAt`은 유지). 복수 응답 설문은 `/api/public/forms/[slug]/responses/[responseId]`가 한 건을 직접 가리킵니다. 응답 ID만으로는 열리지 않고 로그인 응답자의 `respondentId` 또는 익명 응답자의 설문별 게스트 쿠키 해시가 실제 응답과 일치해야 GET/PATCH가 통과합니다.

레이트리밋(`assertRateLimit`, scope `form-submit`/`form-submit-edit`)은 로그인 사용자면 `userId: actor.id`로, 익명이면 IP로 개별화합니다. `getCurrentUser()`를 먼저 부르고 그 결과로 rate limit 키를 정하는 순서인 이유 — 계정 기준이 아니면 같은 학교 공용 IP 뒤 여러 학생의 시도 횟수가 한 버킷에 합산되어, 한 명이 여러 번 틀리면 옆자리 학생까지 막힙니다.

## 후속 기능 모듈

- `branching.ts`: 섹션 배열과 답변으로 실제 도달 필드를 계산하는 클라이언트·서버 공용 정본입니다.
- `response-digest.ts`: 제출 트랜잭션이 누적한 새 응답을 24시간 단위의 소유자 알림으로 소비합니다.
- `file-sweep.ts`: 제출하지 않았거나 수정에서 빠진 임시 설문 파일을 24시간 뒤 정리합니다.
