# Overview

이 폴더는 pyxis 구현에서 `scripts` 영역을 담당합니다.

`yarn verify:learning`은 학생용 교과목/퀴즈/설문 서버 분기, 최소 DTO와 본인 권한 범위,
설문 연결 소유권, 공용 활동 모달의 세 종류 바로가기·모바일·포커스를 검사합니다.
라이브/과제/수업 대기의 정렬·합성 페이지, 교과목 라이브 입장의 서버 권한, 기존 PIN 참여 유지,
열린 학생 모달과 대시보드의 자동 갱신도 검증합니다.
DB와 인증 저장소만 fixture로 대체하고 실제 페이지/API/브라우저 컴포넌트를 실행합니다.
운영 DB를 사용하지 않으며 브라우저 검증은 `PLAYWRIGHT_MODULE_PATH` 설정을 지원합니다.

`yarn verify:access-request-notifications`는 실제 접근 요청 API·알림 생성·SSE 스트림·알림 목록을
실행해 패드 접속 중인 소유자/관리자도 요청 알림·배지를 받고 요청 ID가 유지되는지 검사합니다.
승인·거절 결과도 접속 여부와 무관하게 전달하며, 자기 행동·일반 댓글/반응 중복 방지는 유지합니다.
DB와 Next 인증 저장소만 메모리 fixture로 대체하고 운영 DB 연결을 금지합니다.

`yarn verify:link-guest`는 LINK/PUBLIC/PRIVATE 참여 정책과 실제 Route Handler의 비밀번호·동결·소유권
경계를 검증합니다. `verify-link-guest-policy.ts`는 순수 판정과 PATCH 정규화를, `verify-link-guest-api.ts`는
손님/로그인 방문자의 글·댓글·첨부 변경과 복구·영구삭제를 검사합니다. API 테스트는 DB·요청 쿠키 저장소만
메모리 fixture로 대체하고 운영 DB 연결을 금지합니다.

`yarn verify:pad-nav-layout`는 실제 전역 CSS와 패드 레이아웃 fixture를 Chromium에서 렌더링해
320–1920px 크기 왕복·핀치 확대 복귀·긴 제목·섹션 가로 스크롤에도 상단바와 공유/설정 클릭 영역이
화면 안에 남는지 검사합니다. 별도 설치된 Playwright와 Chromium이 필요하며, 프로젝트 밖 설치는
`PLAYWRIGHT_MODULE_PATH=/path/to/playwright yarn verify:pad-nav-layout`로 지정합니다. 서버·DB는 사용하지 않습니다.

`yarn verify:post-card-menu`도 같은 Playwright 경로 설정을 사용합니다. 실제 PadCanvas·카드·편집기·확인창을
렌더링하고 API/SSE만 메모리로 대체해 본인/관리자/삭제 전용 운영자/손님/동결 권한, 6종 레이아웃,
모바일 메뉴 포털, 입력 직후 수정 저장·동시 편집 초안 보존·409 충돌, 삭제 확인·취소·실패·확인 중 동결,
첨부 SSE 보존, 삭제 응답과 SSE의 중복 차감 방지·복구 후 재삭제·복구 알림 유실 후 페이지 로드,
카드 드래그와의 분리를 검증합니다.

`yarn verify:pad-settings-members`는 실제 설정 탭·접근 요청 UI로 접근 요청의 멤버 탭 배치,
승인 후 목록 갱신(조회 중 승인 포함), 거절·실패, 공개·공유의 초대 링크 유지를 PC/모바일에서
확인합니다. 위와 같은 Playwright 경로를 사용하며 HTTP만 fixture로 대체해 운영 서버·DB에 접근하지 않습니다.

`yarn verify:auth-password-ui`는 실제 AuthForm·전역 CSS로 10자 경계와 200ms 입력 중단 검사,
재입력 시 타이머 취소·오류 제거, 독립적인 비밀번호 보기/숨기기·키보드 조작, 제출 방어 및 대기 상태,
아이디 변경·탭 전환 초기화, 320/390/1280px 페이지·모달 레이아웃을 검증합니다. 위와 같은
`PLAYWRIGHT_MODULE_PATH` 설정을 사용하며 인증 API만 메모리로 대체해 운영 서버·DB에는 접근하지 않습니다.
공통 타이머를 사용하는 검색 훅의 기존 350ms 지연·정규화·최신 콜백·취소 동작도 함께 검사합니다.

`yarn verify:form-editor-autosave`는 실제 FormEditor·저장 훅·저장 스키마를 브라우저에서 실행해
늦은 검증 오류 제외, 수정 시 이전 검증 오류 제거, 첨부 유형 변경 중 자동저장, 성공 응답 뒤
초안·버전 보존 및 권한/인증/충돌/장애 안내 유지를 검사합니다. 인증·운영 API·DB는 사용하지 않습니다.
`yarn verify:field-type-picker`는 공용 메뉴를 쓰는 질문 유형 선택기의 아이콘·설명·선택 상태,
키보드·닫기·포커스·비활성화 및 모바일 배치를 검증합니다. 두 스크립트 모두 위와 같은
`PLAYWRIGHT_MODULE_PATH` 설정을 사용합니다.

`yarn verify:form-save-errors`는 실제 설문 PUT·스키마·저장 함수의 오류 분류를 검증합니다.
입력 검증에만 `FORM_VALIDATION_ERROR`가 붙고 질문/보기 ID 불일치·버전 충돌·JSON 오류는
기존 안내를 유지하는지 확인합니다. 세션과 DB는 fixture로 대체하며 운영 데이터에 접근하지 않습니다.

## Git 공개 범위

설치·빌드에서 사용하는 `sync-viewer-assets.mjs`, 배포용 `deploy.sh`·`deploy-state.mjs`,
공용 DB 관리·회귀 검증 스크립트는 저장소에 포함합니다. `scripts` 전체를 `.gitignore`에 넣지 않습니다.

개인 계정 정보가 들어 있는 `verify-credential-auth.ts`와 `verify-guest-posting.sh`는 로컬에만
보관합니다. 따라서 `yarn verify:auth`와 `yarn verify:guest`는 해당 파일이 있는 로컬 환경에서만
실행할 수 있으며, 새로 clone한 환경의 필수 검증 명령이 아닙니다. 설치·빌드·배포는 이 두 파일을
사용하지 않습니다.

앞으로 개인 운영 스크립트는 `scripts/private/`에, 일회성 점검은 `scripts/_이름.ts`에 두면 Git이
자동으로 제외합니다. 공개 스크립트에는 실제 계정·비밀번호를 넣지 말고 환경 변수로 전달합니다.
Git 제외는 TypeScript 검사 제외가 아니므로 아래 임시 스크립트 규칙도 지킵니다.
`mdFiles/` 역시 로컬 문서 전용이며, 이 규칙은 과거 커밋에서 파일을 지우지는 않습니다.

## 임시 스크립트 규칙

일회성 점검용 스크립트는 `scripts/_이름.ts`처럼 밑줄로 시작하는 이름으로 만들고, **끝나면 반드시
지웁니다.** 남겨 두면 `yarn build`가 함께 타입 검사를 하다가 깨집니다.

빌드가 깨지는 진짜 원인은 "임시 파일이 남았다"가 아니라 **미설치 패키지의 타입을 참조했다**는
것입니다. 예를 들어 playwright는 이 프로젝트의 의존성이 아니라서 아래처럼 쓰면 `tsc`가 타입 선언을
찾지 못하고 실패합니다.

```ts
const pw = require(ABSOLUTE_PATH) as typeof import("playwright-core"); // ✗ 미설치 패키지 타입 참조
import type { Page } from "playwright-core";                          // ✗ 같은 이유
```

의존성에 없는 패키지는 **절대경로 require로 값만 가져오고 타입은 그 파일에 직접 적습니다.**

```ts
type Page = { goto: (url: string) => Promise<unknown>; close: () => Promise<void> }; // ✓ 로컬 타입
const { chromium } = createRequire(import.meta.url)("/absolute/path/playwright-core") as {
  chromium: { launch: (opts: Record<string, unknown>) => Promise<Browser> };
};
```

아래 `verify-*.ts`와 `fixtures.ts`는 임시 파일이 아니라 **남기는 검증 스위트**입니다. 이번
quiz·pad 병합에서 죽은 컬럼과 죽은 링크를 실제로 잡아냈고, 지난번 빌드가 깨진 원인도 이것들이
아니었습니다.

## 스크립트

- `fixtures.ts`: 검증 스크립트가 공유하는 fixture 헬퍼. `createPadActivity()`는 임시 패드용 활동을 만듭니다 — `Board.activityId`가 필수라 보드를 만들 때마다 활동이 함께 있어야 하고, 정리할 때는 보드가 아니라 활동을 지워 cascade로 함께 내려야 고아가 남지 않습니다. 설문은 `createFormActivity()`로 만들고 **정리는 반드시 `deleteFormFixture()`로** 합니다 — `FormAnswer.fieldId`가 RESTRICT라 답변을 먼저 지우지 않으면 활동 삭제가 통째로 실패합니다.
- `backfill-user-pii.ts`: 기존 사용자 평문 프로필을 AES-GCM 암호문과 이메일 HMAC으로 백필합니다. `--dry-run`으로 DB 변경 없이 검증할 수 있으며 원문 개인정보를 출력하지 않습니다.
- `backfill-quiz-images.ts`: 기존 base64 퀴즈 이미지를 50건씩 디스크 파일로 옮깁니다. 원본 컬럼이 바뀌지 않았을 때만 조건부 갱신하며 `--dry-run`을 지원합니다. `yarn db:backfill-quiz-images`로 실행합니다.
- `prune-quiz-images.ts`: 24시간이 지난 미참조 이미지, DB 행이 사라진 디렉터리, 보존 기간이 지난 세션 없는 삭제 퀴즈를 회수합니다. 서버에서도 주기 실행되며 운영 점검에서는 `yarn quiz-images:prune`으로 즉시 실행할 수 있습니다.
- `prune-pad-trash.ts`: 즉시 삭제에 실패해 남은 Pad 첨부와 7일이 지난 글·댓글·섹션·패드를 영구 정리합니다. 서버 시작 1분 뒤와 이후 7일마다 실행되며 `yarn pad-trash:prune`으로 즉시 실행할 수 있습니다.
- `verify-quiz-images.ts`: 실제 Sharp 변환, 경로 차단, 정리 유예, 삭제 퀴즈 purge, 독립 복제와 JPEG 확장자 보존, 교차 퀴즈 참조 차단을 파일 수준에서 검증합니다. `yarn verify:quiz-images`로 실행합니다.
- `verify-quiz-save.ts`: 보기 일괄 SQL이 실제 PostgreSQL에서 ID를 보존하며 텍스트·정답·순서를 갱신하는지와 기존 답안 스냅샷 누락 여부를 확인합니다. `yarn verify:quiz-save`로 실행합니다.
- `verify-quiz-live.ts`: LIVE 시퀀스 절대시각·읽기 시간·리더보드 합집합과 오디오 7개 슬롯을 DB 없이 검사합니다. 학생 Socket.IO의 LIVE 전용 동적 로드, 오디오가 이벤트에서만 울리는지, 점수 비프가 화면 전체에서 제한되는지, range/immutable 스트림과 최근 revision 14개 유예, 설정 조회 합치기·세대 보호·미디어 버퍼 해제·재접속 최종 순위 복원이 유지되는지도 고정합니다. `yarn verify:quiz-live`로 실행합니다.
- `verify-public-quiz-limits.ts`: 실제 정책과 제한기를 사용해 공개 참여·잘못된 PIN·참가자 API 제한을 검사하고, 공개 소켓의 IP 상한이 학교 NAT 뒤 100명보다 작아지지 않으며 참가자별·전체 상한 관계가 유효한지 확인합니다. DB가 필요하며 `yarn verify:public-quiz-limits`로 실행합니다.
- `migrate-credential-login-ids.ts`: `loginIdentifier*` 컬럼명 마이그레이션 뒤 기존 이메일·비밀번호 계정의 이메일 로컬 부분을 영문·숫자 로그인 아이디로 옮깁니다. 카카오 이메일 계정은 건드리지 않으며 충돌 시 사용자 ID 일부를 붙이고 기존 세션을 해제합니다. `--dry-run`을 지원합니다.
- `verify-routes.ts`: `app/**`에서 실제 라우트를 열거한 뒤 `app`·`components`·`lib`·`utils`의 모든 내부 경로 리터럴을 대조해 죽은 링크를 찾습니다. 템플릿 리터럴의 `${...}`는 동적 세그먼트로 보므로 `` `/quiz?${query}` ``처럼 쿼리가 붙은 것도 걸립니다. quiz 이식 직후 `/quizzes`·`/sessions`·`/student-login` 같은 죽은 경로가 남았는데 페이지 GET은 200이라 상태 코드 검증은 통과했고 눌러야만 404가 났습니다. `yarn verify:routes`로 실행하며 서버가 필요 없습니다.
- `verify-security-data.ts`: 평문 컬럼 제거, 활성 전체관리자, 로그인 식별자 암호문↔HMAC 일치와 일반 `loginId`/카카오 이메일 형식, 학생의 10개 소유 한도·금지된 타인 패드 역할, 시스템 권한 대상을 원문 출력 없이 검증합니다. 특정 제목의 운영 보드 존재 여부에는 의존하지 않으며, 비공개 보드의 소유자·멤버 접근은 `verify-board-access-policy.ts`의 임시 fixture가 검증합니다.
- `verify-credential-auth.ts`: 실제 HTTP에서 일반 `loginId` 형식·예약값·대소문자 중복을 확인하고 계정을 잠시 만든 뒤 scrypt 해시, NextAuth Credentials callback, 원문을 숨긴 JWT 세션까지 검증하고 fixture를 정리합니다.
- `verify-admin-http.ts`: 짧은 검증용 전체관리자 세션과 임시 학교·반·부서·회원 11명을 만들어 비로그인 401, 학생 403, 10+1 오프셋 페이지네이션, 일괄 수정, 소속 CRUD·인원수·감사 로그, 회원 소프트 삭제를 실제 HTTP와 DB 양쪽에서 확인한 뒤 모두 정리합니다. 홈 SSR과 학생의 직접 보드 생성 차단도 함께 검사하며 토큰이나 사용자 ID는 출력하지 않습니다.
- `verify-board-access-policy.ts`: 임시 사용자·보드를 생성해 발견 범위, 방문자 권한, 로그인 요구, 멤버십과 소유자 조합 13개를 DAL에서 검증하고 즉시 정리합니다. 과거 `LINK/WRITER/loginRequired=true` 데이터도 익명 읽기는 허용하면서 비멤버의 글·댓글·반응·파일·기존 콘텐츠 수정은 차단하는지, 명시한 LINK/WRITER opt-in은 로그인 방문자의 쓰기와 자기 콘텐츠 수정 버튼에도 반영되는지 확인합니다. `server-only` 모듈을 Node에서 검사하므로 `yarn verify:access`의 `react-server` 조건으로 실행합니다.
- `verify-short-links.ts`: slug 형식과 후속 보안 마이그레이션을 검사하고, 임시 DB 행으로 비활성 예약·새 주소 교체·같은 콘텐츠의 과거 주소 복구·다른 콘텐츠의 예약 주소 탈취 차단을 검증한 뒤 정리합니다.
- `verify-board-password-security.ts`: 공유 비밀번호 scrypt가 이벤트 루프를 양보하는지, 정답·오답 검증과 같은 비밀번호 재설정 시에도 쿠키 서명이 회전하는지, 원문 조회 API의 재인증·감사·제한과 PATCH 본문 상한이 유지되는지 검사합니다.
- `verify-board-create-options.ts`: 임시 학교·교사·교과목·초대 후보를 만든 뒤 생성 전 후보 검색의 조직 격리와 식별자 마스킹, 교과목/멤버 동시 생성, 둘 다 선택하지 않은 생성, OWNER/MEMBER·팔로우 저장을 실제 HTTP와 DB로 검사합니다. 타인 소유 교과목과 다른 학교 멤버를 조작해 보낸 요청도 거절하는지 확인하고 fixture를 정리합니다. `yarn verify:board-create-options`로 실행합니다.
- `verify-seo-metadata.ts`: 임시 LINK·PUBLIC·PRIVATE·비밀번호 보호 패드를 만들어 LINK/PUBLIC의 제목·설명 노출, LINK noindex, PUBLIC index, 보호 패드의 제목 비노출과 기본 썸네일 전환을 검사합니다. 공개 패드의 OG 입력이 같으면 이미지 URL 버전이 유지되고 표시 값이 바뀌면 버전이 달라지는지도 확인합니다. Pretendard와 logo.svg를 포함한 보드/기본 OG 이미지도 실제 PNG 바이트로 렌더링한 뒤 fixture를 정리합니다. `yarn verify:seo`로 실행합니다.
- `verify-link-preview.ts`: HTML 3MB 상한과 `</head>` 조기 종료, YouTube URL 형식, `javascript:` URL과 `onerror` 속성 탈출 문자열 거부를 네트워크 요청 없이 검증합니다. `yarn verify:link-preview`로 실행합니다.
- `verify-export-rate-limits.ts`: 빈 임시 패드와 소유자 세션을 만들어 XLSX 5회/분, 첨부 ZIP 3회/분까지 허용되고 다음 요청은 429가 되는지 실제 HTTP로 검증합니다. `yarn verify:export-limits`로 실행합니다.
- `verify-forms-schema.ts`: 설문 도메인에서 **응용 코드가 틀려도 DB가 막는지**를 확인합니다. 1인 1응답(`dedupeKey` 중복 삽입이 P2002), 복수 응답 허용 시 null이 여러 건 통과하는지, 익명 응답자의 쿠키 해시도 같은 방어선을 받는지, 응답이 달린 질문 삭제가 P2003으로 막히는지, 없는 활동을 가리키는 설문이 거부되는지를 봅니다. 설문을 통째로 지울 때 답변을 먼저 지워야 한다는 순서 요구(`FormAnswer.fieldId`가 RESTRICT라 활동만 지우면 cascade가 통째로 실패)도 여기서 붙잡아 둡니다 — 어느 날 조용히 통과하기 시작하면 `scripts/fixtures.ts`와 `lib/forms/overview.md`의 주석이 낡았다는 뜻입니다. 응답 확인(`validateAnswer`— 존재하지 않는/중복된 보기 ID 거부 포함)과 서명 좌표 검증, 중첩 수량자 정규식이 실행되지 않고 즉시 빠지는지(시간으로 확인), 일정 교차 검증(`openAt < closeAt`), 발행 시 마감 재개 정책(`shouldClearCloseAt`)도 네트워크 없이 함께 훑습니다. `yarn verify:forms-schema`로 실행합니다.
- `verify-forms-save.ts`: 편집기의 전체 문서 저장(PUT)이 실제 PostgreSQL에서 무엇을 보존하고 무엇을 거부하는지 확인합니다. 보기 텍스트·순서를 바꿔도 **ID가 보존**되는지(바뀌면 그 보기를 고른 과거 응답 집계가 0이 됩니다), 유형을 바꾸면 이전 유형 열이 명시적으로 비워지는지, 없는 질문 ID를 담은 저장이 부분 적용 없이 통째로 거부되는지, 응답이 달린 질문 삭제가 `confirmDestructive` 없이 막히는지, **응답을 받는 중(OPEN)에도 질문 추가·유형 변경·삭제가 전부 되는지**, 낡은 `expectedUpdatedAt`으로 보낸 저장이 낙관적 동시성으로 거부되는지, 제목을 바꾸면 `/report`가 읽는 활동 레코드도 따라가는지를 봅니다. HTTP를 거치지 않고 `lib/forms/save.ts`를 직접 부릅니다. `yarn verify:forms-save`로 실행합니다.
- `verify-form-editor-merge.ts`: 저장 요청 뒤에도 계속 편집했을 때 서버 응답의 문서 버전·새 질문/보기 ID만 합쳐지고 뒤이어 입력한 내용·추가 질문은 덮어쓰지 않는지, 분기형 질문 복제가 같은 섹션의 두 번째 분기 규칙을 만들지 않는지 DB 없이 확인합니다. `yarn verify:form-editor-merge`로 실행합니다.
- `verify-forms-submit.ts`: 공개 제출 API를 실제 HTTP로 검증합니다(`verify-export-rate-limits.ts`와 같은 방식). 익명 제출과 게스트 쿠키 발급, 같은 쿠키의 재제출 거부, 서버 측 재검증(빈 필수값·존재하지 않는 보기 ID), **정원 동시 제출**(`Promise.all`로 실제 동시 요청 두 건을 쏘아 정확히 하나만 통과하는지), 마감된 설문의 정의 은닉과 제출 거부, 제출 후 PATCH 수정과 복수 응답 설문의 PATCH 거부, 로그인 필요 설문의 401/201, 레이트리밋 429를 봅니다. 레이트리밋은 로그인 사용자면 계정, 익명이면 IP로 개별화되므로 `checkLoginRequired`가 앞선 검사들의 익명 시도 횟수에 영향받지 않습니다. `yarn verify:forms-submit`으로 실행합니다.
- `verify-forms-responses.ts`: 응답 집계·XLSX·공유(5단계)를 HTTP 없이 직접 검증합니다. 보기를 지운 뒤에도(응답이 있어도 저장 API가 보기 삭제를 막지 않습니다) 그 응답이 "지워진 보기" 버킷으로 남는지, 그리드 행 이름을 바꿔도(행에는 안정된 ID가 없습니다) 옛 응답이 그때 라벨로 살아남는지, 척도 평균·분포, 텍스트 응답 목록, 개별 응답 페이지네이션과 익명 번호 매기기, 다른 설문의 응답 ID로는 상세를 못 보는지, XLSX 버퍼를 다시 파싱해 헤더·값이 맞는지, 공유 업서트·재공유·자기 자신/학생 공유 거부·제거와 `FORM_SHARED` 알림 생성을 봅니다. `yarn verify:forms-responses`로 실행합니다.
- `verify-forms-followups.ts`: 섹션 분기 필수 검사, 파일 소유권과 답변 귀속, 일일 요약 중복 방지, 복수 응답 중 지정한 한 건만 수정되는지를 실제 PostgreSQL 행으로 검증합니다. `yarn verify:forms-followups`로 실행합니다.
- `verify-post-pagination.ts`: 공개 임시 보드에 고정 글을 포함한 게시물 35개를 만들고 실제 3001 HTTP API의 30개/5개 cursor 페이지를 조회해 중복·누락·정렬을 검증한 뒤 보드를 삭제합니다.
- `verify-post-participation.ts`: 짧은 검증 세션과 임시 보드로 레이아웃·필드 설정, 오래된 필드 버전 거부, 링크 첨부와 20개 제한, 단일/복수 반응, 댓글 답글·수정, 서버 검색을 실제 HTTP API에서 검사하고 관련 DB 행을 함께 확인한 뒤 보드를 삭제합니다.
- `verify-pad-realtime-merge.ts`: 다른 사용자의 새 글·본문·댓글 SSE를 받아도 현재 카드 배치를 보존하는 병합, 실제 재정렬·고정 변경만 배치 변경으로 분류하는 규칙, 드래그 취소 시 동시 생성 글을 남기고 움직인 카드만 복원하는 동작과 최신 이웃 position 계산을 DB 없이 확인합니다. `yarn verify:pad-realtime`로 실행합니다.
- `verify-performance-boundaries.ts`: 공용 workspace 레이아웃에 패드/교과목 전체 조회가 다시 들어오지 않는지, 상주/반복 링크가 상세 라우트를 한꺼번에 prefetch하지 않는지, 공개 로그인·전역 대화상자·admin 탭 UI가 동적 청크로 격리됐는지, 알림 상세 지연 조회와 목록/Office/HWP/카메라 취소, 문서 변환·소켓·rate limiter 캐시 상한, 학교 공용 IP의 실패 전용 로그인 제한을 검사합니다. 또한 퀴즈 실제 플레이 미리보기·세션 모달·후보 목록, 폼 서명 엔진·설정·QR 모달, 패드 작성기가 초기 청크에 다시 합쳐지지 않는지와 패드 첫 응답의 섹션별 30개 페이지 경계를 확인합니다. 퀴즈 기록·과제의 30개 서버 페이지, 동시 소켓 입장 및 답안 폭주의 현재 세션·문항 조회 병합, 호스트 전용 집계 room, 채점기의 검증 문항 재사용, 정책 캐시 세대 보호, 닫힌 패널 GET 취소와 로그인 퀴즈 자동 입장 effect의 요청·재실행 잠금 정리도 고정합니다. 일반 `PostCard`에 `@dnd-kit`이 새지 않는지, 숨은 탭의 알림·패드 SSE가 해제되는지, 공용 UI가 기능 폴더를 역으로 import하지 않는지, admin 목록 프리미티브가 다시 복제되지 않는지도 확인합니다. 서버와 DB 없이 `yarn verify:performance`로 실행합니다.
- `verify-api-boundaries.ts`: 쓰기 Route Handler의 same-origin, 공개 JSON 본문 상한, 오류 400/413/500·비캐시 경계, 학교 NAT에서 로그인 퀴즈 참여의 사용자별 제한과 공개 소켓 IP 기본 200, 공개 PIN 이중 제한, 회원가입 제한의 DB 조회 선행 차단, 관리자 정책 저장의 본문 상한·감사 원자성, 대량 멤버·교과목 초대의 일괄 처리, 답안 중복 제출 수렴을 소스에서 검사합니다. 서버와 DB 없이 `yarn verify:api-boundaries`로 실행합니다.
- `verify-dashboard-data.ts`: 검증용 공유 보드와 접근 요청 보드를 잠시 생성해 `SHARED`·최근 본·`PENDING` 표시를 확인하고 항상 삭제합니다. 이어 활성 사용자들의 대시보드 DTO에서 소유·공유·전역 관리 관계, 멤버 역할, 최근 본 보드 최대 6개와 내림차순, 접근 요청 상태가 실제 관계 테이블과 일치하는지 검사합니다. `server-only` 데이터 계층이므로 `NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-dashboard-data.ts`로 실행합니다.
- `verify-board-reuse.ts`: 전용 원본 보드·게시물·로컬 파일을 만들어 선택 복제, 비공개 기본값, 작성자 치환, 첨부 파일 복사, 멤버 정책, 템플릿, 즐겨찾기, 사용자 폴더와 `SAVED` 관계를 검사합니다. 원본 파일이 없을 때 복제본 DB·파일이 남지 않는 실패 복구도 확인하고 모든 fixture를 정리합니다. `NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-board-reuse.ts`로 실행합니다.
- `verify-board-succession.ts`: 소유자 계정이 삭제될 때 패드가 어떻게 넘어가는지 검증합니다. 임시 사용자·보드를 만들어 패드 ADMIN → 학교 대표교사 순으로 승계되는지, 이어받을 사람이 아무도 없으면 보드가 삭제되지 않고 `FROZEN`(읽기 전용)으로 남는지 확인한 뒤 정리합니다. 패드 내용은 소유자 한 명이 아니라 학생들이 쓴 글이라 함께 지우면 안 됩니다. `yarn verify:succession`으로 실행합니다.
- `verify-student-roster.ts`: 엑셀 명단으로 학생 계정을 일괄 발급하는 경로를 검증합니다. 학번 접두사 정규화, 로그인 아이디·닉네임 중복 판정(암호문이 아니라 HMAC 조회 키로), scrypt 비밀번호 해시와 검증, 실패 행 보고를 실제 파일 파싱까지 포함해 확인하고 fixture를 정리합니다. `yarn verify:roster`로 실행합니다.
- `backfill-nickname-lookups.ts`: 기존 사용자 닉네임의 HMAC 조회 키(`nicknameLookup`)를 채웁니다. 닉네임이 암호화되어 있어 중복 검사를 암호문으로는 할 수 없고, 이 조회 키가 없는 사용자는 중복 판정에서 조용히 빠집니다.
- `create-super-admin.ts`: 개발용 전체관리자를 아이디·비밀번호로 만듭니다. 운영에서는 `BOOTSTRAP_SUPER_ADMIN_EMAIL`과 일치하는 카카오 첫 로그인이 승격시키지만, 개발 DB를 새로 만들면 그 경로를 쓸 수 없어 관리 화면에 아무도 들어갈 수 없습니다. 같은 아이디가 이미 있으면 역할만 올리고 비밀번호는 두며 그때 `authVersion`을 올려 기존 세션을 끊습니다. `lib/auth/password.ts`가 `server-only`라 `yarn db:create-admin`의 `react-server` 조건으로 실행합니다.
- `rotate-user-pii.ts`: 암호문에 기록된 이전 키로 복호화한 뒤 현재 활성 키로 사용자 프로필을 재암호화합니다. 먼저 `--dry-run`으로 전체 복호화·재암호화 검증을 수행합니다. HMAC 검색 키 회전은 이 스크립트 범위가 아닙니다.
