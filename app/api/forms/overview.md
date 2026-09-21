# 설문 API 개요

작성 계열입니다. 익명 응답을 받는 공개 계열은 `app/api/public/forms/`(다음 단계)에 따로 둡니다 — `isOpenApiPath`가 `/api/public/*`만 인증을 건너뛰기 때문입니다.

| 라우트 | 메서드 | 비고 |
|---|---|---|
| `/api/forms` | POST | 생성. 활동 레코드와 빈 질문 하나를 같은 트랜잭션에서 만듭니다. **학생은 만들 수 없습니다**(응답에 개인정보가 담깁니다) |
| `/api/forms/[formId]` | GET | 편집기가 읽는 문서 전체 |
| | PUT | 편집기의 전체 문서 저장. 알고리즘은 `lib/forms/save.ts` |
| | DELETE | 소프트 삭제. 응답은 남고 목록에서만 사라집니다 |
| `/api/forms/[formId]/publish` | POST | `status=OPEN`, 활동의 `startedAt` 기록 |
| `/api/forms/[formId]/close` | POST | `status=CLOSED`, 활동의 `endedAt` 기록 |

설문 목록은 API를 한 번 더 호출하지 않습니다. `/forms`, `/forms/open`, `/forms/drafts`, `/forms/closed`의 서버 컴포넌트가 `lib/forms/list.ts`를 직접 호출해 해당 상태의 20개와 상태별 개수를 첫 렌더에 포함합니다. `?page=`만 목록 페이지네이션으로 남고 예전 `?view=` 주소는 정식 하위 경로로 이동합니다.

전 라우트가 `assertSameOrigin` → 인증 → 도메인 가드(`lib/forms/access.ts`) → zod parse → `try/catch` + `apiError` 순서를 따릅니다. 읽기 라우트는 `assertSameOrigin`을 생략합니다.

> 이 순서가 한동안 DELETE에서 깨져 있었습니다 — `assertSameOrigin(request)` 호출이 빠진 채 `_request`로 매개변수를 무시하고 있었습니다. 다른 쓰기 라우트와 같은 자리에 넣어 고쳤습니다. 매번 이 순서를 손으로 맞추는 대신, 새 라우트를 만들 때는 기존 라우트를 복사해서 시작하는 편이 이런 누락을 줄입니다.

## PUT이 `status`를 건드리지 않습니다

퀴즈는 저장하면 `isPublished`가 false로 내려갑니다. 설문은 저장해도 `OPEN` 상태를 유지하며 질문 추가·수정·삭제를 모두 허용합니다. 기존 답변이 달린 질문 삭제만 409 `needsConfirm`으로 한 번 멈추고, 사용자가 확인하면 해당 답변과 질문을 함께 삭제합니다.

## PUT의 입력 검증 오류는 별도 코드로 구분합니다

400 중 스키마 검증 실패에는 `code: "FORM_VALIDATION_ERROR"`를 붙입니다. 편집기는 저장 요청 이후
입력이 바뀐 경우에만 이 오래된 검증 안내를 생략하고, 현재 문서를 다음 자동저장에 재시도합니다.
질문·보기 ID 불일치나 잘못된 JSON도 400이지만 이 코드는 붙이지 않습니다. 새로고침이 필요한
오류까지 입력 오류로 취급해 숨기지 않기 위한 구분입니다.

## PUT은 두 가지 이유로 409를 돌려줍니다

에러 문구를 문자열로 비교하는 방식은 문구를 고치는 순간 조용히 깨지므로, 편집기가 구분해야 하는 두 상황을 서로 다른 플래그로 내려보냅니다.

- **파괴적 저장** — 응답이 달린 질문을 지우려 하면 `DestructiveSaveError`가 나고 `{ needsConfirm: true, answerCount }`를 돌려줍니다. 편집기는 몇 건이 사라지는지 보여 준 뒤 승인한 동일 문서를 한 번만 `confirmDestructive: true`로 재시도합니다. 확인 중 문서가 바뀌면 서버가 삭제 범위를 다시 계산하도록 새 저장부터 시작합니다.
- **동시 저장 충돌** — 다른 탭이나 공유받은 EDITOR가 그 사이에 먼저 저장했으면 `ConflictSaveError`가 나고 `{ needsReload: true }`를 돌려줍니다. 편집기는 자동으로 합치지 않고 새로고침을 안내합니다 — `expectedUpdatedAt`이 `Form.updatedAt`과 다를 때이며, 자세한 이유는 `lib/forms/overview.md`의 "낙관적 동시성" 참고.

## 발행 검사는 편집기와 같은 함수를 씁니다

`fieldCompletionError`(`lib/forms/field-schema.ts`)를 화면과 발행 API가 함께 부릅니다. 화면에서만 검사하면 요청을 직접 보내 빈 설문을 발행할 수 있고, 서버에만 두면 어느 질문이 문제인지 짚어 줄 수 없어 `fieldIndex`를 함께 돌려줍니다.

## 발행이 마감 예약을 지우는 건 이미 지난 경우뿐입니다

`shouldClearCloseAt()`(`lib/forms/access.ts`)로 판정합니다. 예전에는 발행할 때마다 무조건 `closeAt: null`이었는데, 그러면 **첫 발행에서도** 설정 패널에서 미리 정한 마감 예약이 사라졌습니다. 이미 지난 마감만 지우면 재개(`CLOSED → OPEN`)는 여전히 곧바로 다시 닫히지 않으면서, 처음 발행할 때 정한 미래의 예약은 살아남습니다. 활동의 `startedAt`은 **비어 있을 때만** 채웁니다 — 처음 발행 시각을 유지해야 `/report`의 시간축이 흔들리지 않습니다.
