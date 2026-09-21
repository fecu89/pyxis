# Overview

이 폴더는 pyxis 구현에서 `lib` 영역을 담당합니다.

- `auth/`: NextAuth 세션과 중앙 인증·인가
- `board/`: 보드 접근 계산과 조회
- `files/`: 업로드 검증, 파일명, 경로, 이미지 변환과 정리
- `security/`: 개인정보 암호화와 검색용 HMAC
- `users/`: 암호화 사용자 레코드를 목적별 최소 DTO로 변환
- `use-debounced-callback.ts`: 마지막 입력만 지연 실행하는 공용 클라이언트 훅. 재호출·지연 변경·언마운트 시 타이머를 취소하며 최신 콜백을 사용합니다. `use-debounced-search.ts`는 기존 350ms 지연과 검색어 정규화를 유지하고, 회원가입 비밀번호 확인은 정규화 없이 200ms로 사용합니다.
- `quiz/`: 퀴즈 도메인. 퀴즈·문항 CRUD 권한, 채점, 세션 리포트·기록 조회, 참여형 집계, 게스트 참여 쿠키. quiz 프로젝트에서 이식하면서 identity 결합 네 곳을 pad 기준으로 바꿨습니다 — `displayNameEncrypted`→`nameEncrypted`(`toPublicAuthorDTO`), `createdById` 기반 학생 관리→학교 소속 기반, `AppPolicy`→`SystemSetting`.
- `auth/permissions.ts`: DB·세션에 의존하지 않는 순수 권한 판정. `authorization.ts`는 `server-only`라 커스텀 소켓 서버(`server.ts`, 순수 Node)에서 가져오면 모듈 로드 시점에 터지므로 갈라 두었고, `authorization.ts`가 다시 내보내 기존 호출부는 그대로입니다.
- `routes.ts`: 경로·구역(`marketing`/`auth`/`workspace`/`focus`/`play`)·메뉴 표시·필요 역할과 권한을 한곳에 선언한 라우트 매니페스트입니다. 사이드바와 `proxy.ts`, 링크 생성기(`href`)가 같은 선언을 읽어 "메뉴엔 보이는데 들어가면 403"이 생기지 않게 합니다. `proxy.ts`(Node 런타임)와 Client Component 양쪽에서 평가되므로 React·lucide-react·`server-only`에 의존하지 않습니다 — 아이콘은 문자열 키로만 담고 실제 컴포넌트 매핑은 `components/shell/nav-icons.tsx`가 가집니다. `proxy.ts`의 `config.matcher`는 Next가 빌드 시점에 AST로 정적 추출하므로 여기서 만들 수 없어 리터럴로 둡니다. 메뉴 항목은 `nav.parent`로 하위 항목을, `nav.countKey`로 개수 배지를 선언할 수 있습니다. 메뉴에서 화면을 전환하는 항목은 모두 정식 경로이며 쿼리는 검색·정렬·페이지네이션 같은 목록 상태에만 씁니다.
- `http.ts`: 모든 Route Handler가 공유하는 `apiError()`(에러 응답 통일)와 `assertSameOrigin()`(CSRF 방지 same-origin 검사). 자체 호스팅은 환경별 `APP_ORIGINS`의 전체 origin을 비교하고, 이 값이 없는 Vercel 배포에서만 플랫폼이 덮어쓰는 `X-Forwarded-Host`를 신뢰합니다.

## `apiError()` 내부 에러 메시지 노출 방지 (2026-07-29 보안 점검)

기존에는 `AuthenticationError`/`AuthorizationError`가 아닌 에러는 전부 `error.message`를 그대로 응답에 실었습니다. 라우트가 의도적으로 던지는 `new Error("한글 사용자 메시지")`나 `AttachmentLimitError` 같은 커스텀 에러는 그게 맞지만, 체크가 `instanceof Error`뿐이라 예상 못 한 Prisma 내부 에러(제약조건·필드명 노출)나 버그로 난 `TypeError` 등의 메시지까지 그대로 새어나갔습니다.

`isSafeToExposeMessage()`를 추가해 생성자 이름이 `PrismaClient`로 시작하거나 `TypeError`/`RangeError`/`ReferenceError`/`SyntaxError`/`URIError`/`EvalError`인 경우에만 라우트가 넘긴 `fallback` 문자열로 바꿔치기합니다. 그 외(코드베이스 전체가 실제로 쓰는 의도적인 에러 메시지 패턴)는 그대로 통과하므로, `apiError`를 쓰는 약 150개 라우트 어디도 고칠 필요 없이 이 한 곳만 바꿔서 적용됩니다. `console.error(error)`는 그대로 남아있어 서버 로그에는 전체 에러가 계속 기록됩니다.

변경한 경로: `lib/http.ts`
