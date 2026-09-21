<div align="center">

# pyxis를 만든 이야기

**교실과 워크숍에서 포스트잇처럼 의견을 모으는 실시간 협업 보드**를 왜, 어떻게 만들었는지 정리한 글입니다.

</div>

---

## 목차

- [왜 만들었나](#왜-만들었나)
- [만드는 과정](#만드는-과정)
- [구조](#구조)
- [주요 기능](#주요-기능)
- [사용법](#사용법)
- [기술 스택](#기술-스택)
- [회고](#회고)

## 왜 만들었나

> ✍️ **[초안] 여기에 직접 채워주세요.**
> - 어떤 상황(수업, 워크숍, 학교 업무 등)에서 필요성을 느꼈는지
> - Padlet 같은 기존 서비스 대신 직접 만든 이유(비용? 기능 커스터마이징? 학생 개인정보 처리 방식? 학교 내부망/정책 이슈?)
> - 처음 목표로 삼았던 범위(학급 몇 개, 사용자 규모 등)

## 만드는 과정

커밋 로그를 보면 2026-07-24부터 2026-07-30까지, 약 일주일에 걸쳐 만들어졌습니다.

| 날짜 | 단계 |
|---|---|
| 07-24 | 프로젝트 생성 |
| 07-25 | 초안 제작, 최적화 |
| 07-26 | 카카오 로그인 및 사용자 권한 체계 도입 |
| 07-27 | 클로드(Claude Code)와 함께 기능 협업 |
| 07-28 | 디자인 전면 개편(여러 차례), 레이아웃/파일 정리, 기능 수정과 보안 점검(audit fix) |
| 07-29 | UI 다듬기, 검색 인덱스, 관리자/서브관리자 권한 정리 |
| 07-30 | 패드 보관함(휴지통), 삭제 라우트, 설정 UI 개선, 라우트 보안 강화, 썸네일 기능 추가로 v1 완성 |

> ✍️ **[초안] 여기에 직접 채워주세요.**
> - 가장 오래 걸렸던/까다로웠던 부분 (예: 카카오 OAuth 연동, PII 암호화 설계, 드래그 앤 드롭 접근성 등)
> - Claude Code를 어떤 방식으로 활용했는지(기능 구현, 리뷰, 리팩토링 등 — 위 커밋 로그의 "클로드 코덱스 협업"이 어떤 작업이었는지)
> - 중간에 방향을 바꾼 결정이 있다면(예: "전체 디자인 변경중" 커밋처럼 디자인을 갈아엎은 이유)

## 구조

pyxis는 Next.js App Router 위에서 **서버 컴포넌트가 화면 최초 데이터를 직접 조회**하고, **클라이언트 컴포넌트는 REST 형태의 Route Handler만 호출**하는 단순한 흐름을 따릅니다. Server Action은 쓰지 않습니다.

```text
브라우저
├─ 최초 진입 / 새로고침
│  └─ app/**/page.tsx (Server Component) → lib/*/queries.ts 직접 조회
├─ 클릭·폼·드래그·업로드
│  └─ components/** (Client Component) → app/api/**/route.ts
└─ 실시간 변경
   └─ EventSource → 보드 SSE / 개인 알림 SSE

Route Handler
├─ 세션·역할·보드 접근 재검사 (JWT를 그대로 믿지 않고 DB에서 다시 계산)
├─ Zod 입력 검증 + same-origin 검사
├─ lib/** 도메인 로직 → Prisma → PostgreSQL
├─ 로컬 파일 → UPLOAD_DIR
└─ 활동·알림 저장 → SSE 이벤트 발행
```

폴더별 역할:

- `app/(dashboard)`: 내 패드·즐겨찾기·검색·폴더·마이페이지가 공유하는 사이드바 셸
- `app/onboarding`, `app/approval-pending`: 신규 학생 가입, 교사 승인 대기
- `app/b/[slug]`: 패드 본문·게시물 상세·발표(present)·인쇄
- `app/admin`: 사용자·소속·교사 가입 요청·감사 로그 관리
- `app/api`: 인증된 변경과 공개 읽기를 처리하는 Route Handler
- `lib`: 인증·권한·보드·사용자·파일·알림 도메인 로직
- `prisma`: PostgreSQL 스키마와 순차 마이그레이션

보안 관련해서는 보드 접근 권한을 클라이언트가 받은 capability(화면 노출용)로 판단하지 않고, 모든 API가 매 요청마다 DB의 최신 사용자·멤버십·정책을 다시 확인합니다. 로그인 식별자(일반 아이디 또는 카카오 이메일)·닉네임 등 개인정보는 암호화해 저장하고, 중복 확인은 별도 HMAC 조회 키로만 처리합니다.

더 자세한 화면-API-DB 연결은 [`structure.md`](../structure.md), 폴더별 세부 정책은 각 폴더의 `overview.md`를 참고하세요.

## 주요 기능

- **역할과 권한** — 학생·교사·전체관리자 역할, 학교·학급 소속, 보드별 소유자/관리자/편집자/멤버/뷰어 권한
- **보드 편집** — 섹션·카드 생성/수정/정렬/소프트 삭제, 길게 눌러 순서 바꾸기(키보드 조작 지원), 담벼락/격자/피드/타임라인/표/열 등 여러 레이아웃
- **보관함과 복구** — 글·댓글·섹션·패드는 삭제 후 7일간 복구 가능, 첨부파일은 즉시 영구 삭제
- **댓글·반응·멘션** — 답글 트리, 이모지 반응, 사용자 멘션
- **첨부파일과 링크** — 이미지 자동 WebP 변환·썸네일, 매직바이트 검증, 링크 자동 미리보기(제목·대표 이미지)
- **세분화된 패드 설정** — 기본 정보·공개 범위·외형·게시물 필드·참여 및 첨부 권한·승인/동결·멤버 역할까지 7개 탭
- **실시간 갱신** — SSE 기반 이벤트로 새로고침 없이 반영
- **내보내기** — CSV/XLSX/첨부파일 ZIP, 인쇄용 뷰, 발표 모드
- **보안 기본기** — CSRF same-origin 검사, rate limit, PII 암호화·마스킹, 보안 응답 헤더

## 사용법

> 아래 스크린샷은 교사·학생·전체관리자 세 역할로 각각 로그인해 실제로 찍은 화면입니다.

**1. 로그인하면 내가 만든 패드와 최근 방문한 패드를 한눈에 봅니다.**

<img src="../docs/screenshots/01-teacher-home.png" alt="교사 홈 화면 — 내가 만든 패드 카드 목록" width="900" />

**2. 섹션(열)으로 주제를 나누고, 카드나 섹션 헤더를 길게 눌러 순서를 바꿉니다.**

<img src="../docs/screenshots/02-teacher-board.png" alt="패드 화면 — 섹션 3개와 카드들" width="900" />

**3. 섹션의 `+` 버튼으로 새 카드를 작성합니다. 파일·사진·음성·링크를 함께 첨부할 수 있습니다.**

<img src="../docs/screenshots/03-teacher-composer.png" alt="게시물 작성 모달" width="900" />

**4. 학생 계정으로 들어가면 같은 패드가 참여 권한에 맞춰 보입니다.**

<img src="../docs/screenshots/04-student-board.png" alt="학생 계정으로 본 같은 패드" width="900" />

**5. 카드를 열면 상세 페이지에서 본문을 읽고 반응·댓글을 남깁니다.**

<img src="../docs/screenshots/05-student-post-detail.png" alt="게시물 상세 페이지" width="900" />

**6. 전체관리자는 별도 콘솔에서 사용자·권한·소속, 교사 가입 승인, 감사 로그를 관리합니다.**

<img src="../docs/screenshots/06-admin-panel.png" alt="관리자 센터" width="900" />

**7. 이미지·문서를 끌어놓아 첨부하거나, 링크를 붙여넣으면 자동으로 미리보기 카드가 됩니다.**

<img src="../docs/screenshots/07-composer-attachments.png" alt="게시물 작성 모달 — 첨부와 링크" width="900" />
<img src="../docs/screenshots/08-thumbnail-and-link-card.png" alt="보드에 반영된 썸네일과 링크 미리보기" width="900" />

**8. 카드와 섹션을 드래그해 다른 위치로 옮길 수 있습니다.**

<img src="../docs/screenshots/09-card-drag.gif" alt="카드를 다른 섹션으로 드래그해 옮기는 과정" width="900" />

**9. 섹션을 추가·수정하고, 순서도 드래그로 바꿉니다.**

<img src="../docs/screenshots/10-section-add.png" alt="새 섹션 열기 모달" width="900" />
<img src="../docs/screenshots/11-section-menu.png" alt="섹션 메뉴" width="900" />
<img src="../docs/screenshots/12-section-drag.gif" alt="섹션 순서를 드래그해 바꾸는 과정" width="900" />

**10. 패드 설정에서 레이아웃·색상·글꼴·참여 권한·멤버를 관리합니다.**

<img src="../docs/screenshots/13-settings-appearance.png" alt="패드 설정 › 외형" width="900" />
<img src="../docs/screenshots/14-settings-participation.png" alt="패드 설정 › 참여·첨부" width="900" />
<img src="../docs/screenshots/15-settings-members.png" alt="패드 설정 › 멤버" width="900" />

**11. 패드 배경 이미지가 내 패드 목록의 카드 표지로도 함께 쓰입니다.**

<img src="../docs/screenshots/16-home-cover-thumbnail.png" alt="배경 이미지가 카드 표지로 보이는 모습" width="900" />

설치·환경 변수·카카오 로그인 앱 설정 등 실행 방법은 [`README.md`](../README.md)의 [처음부터 설치하기](../README.md#처음부터-설치하기)를 참고하세요.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프레임워크 | Next.js 16 (App Router), React 19, TypeScript |
| 데이터베이스 | PostgreSQL, Prisma ORM |
| 인증 | NextAuth (카카오 OAuth) |
| 드래그 앤 드롭 | @dnd-kit |
| 스타일 | Tailwind CSS 4, CSS Modules |
| 콘텐츠 렌더링 | react-markdown, rehype-sanitize |
| 파일 처리 | busboy, sharp, file-type |
| 내보내기 | exceljs, archiver |

## 회고

> ✍️ **[초안] 여기에 직접 채워주세요.**
> - 만들면서 새로 배운 것
> - 아쉬운 점 / 다음에 개선하고 싶은 부분
> - 실제로 써본 사람들(학생·교사)의 반응이 있었다면
