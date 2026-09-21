<div align="center">

# pyxis

**교실과 워크숍에서 포스트잇처럼 의견을 모으는 실시간 협업 보드**

Next.js (App Router) · PostgreSQL · Prisma · dnd-kit로 만들었습니다.

</div>

---

## 목차

- [소개](#소개)
- [스크린샷으로 보는 사용법](#스크린샷으로-보는-사용법)
  - [1~6. 기본 화면 둘러보기](#1-교사--내-패드-홈)
  - [7. 게시물 작성 — 파일·링크 첨부와 썸네일](#7-교사--게시물-작성-파일링크-첨부와-썸네일)
  - [8. 카드와 열 옮기기](#8-교사--카드와-열섹션-옮기기)
  - [9. 열(섹션) 추가·수정](#9-교사--열섹션-추가수정)
  - [10. 패드 설정](#10-교사--패드-설정)
  - [11. 패드 배경 이미지 = 홈 화면 카드 표지](#11-교사--패드-배경-이미지--홈-화면-카드-표지)
- [주요 기능](#주요-기능)
- [기술 스택](#기술-스택)
- [처음부터 설치하기](#처음부터-설치하기)
  - [0. 준비물](#0-준비물)
  - [1. 저장소 내려받기](#1-저장소-내려받기)
  - [2. PostgreSQL 설치](#2-postgresql-설치)
  - [3. 데이터베이스와 사용자 만들기](#3-데이터베이스와-사용자-만들기)
  - [4. 패키지 설치](#4-패키지-설치)
  - [5. 환경 변수(.env.local) 만들기](#5-환경-변수envlocal-만들기)
  - [6. 카카오 로그인 앱 만들기](#6-카카오-로그인-앱-만들기)
  - [7. 데이터베이스 스키마 적용 + 데모 데이터](#7-데이터베이스-스키마-적용--데모-데이터)
  - [8. 개발 서버 실행](#8-개발-서버-실행)
  - [자주 겪는 오류](#자주-겪는-오류)
- [검증 명령](#검증-명령)
- [운영 배포](#운영-배포)
- [문서 지도](#문서-지도)

## 소개

pyxis는 교사가 반을 만들고, 학생들이 카드(게시물)로 생각을 모으는 Padlet 스타일의 보드 서비스입니다. 섹션(열) 단위로 주제를 나누고, 카드를 길게 눌러 순서를 바꾸고, 댓글·반응으로 서로의 생각에 응답합니다. 로그인 아이디·비밀번호 또는 카카오로 시작할 수 있고, 학교·학급 단위 권한 관리와 학생 개인정보 암호화까지 갖추고 있습니다.

## 스크린샷으로 보는 사용법

아래 화면은 시드의 예시 학교·패드 데이터를 사용해 교사·학생·전체관리자 화면을 각각 점검한 스크린샷입니다.

### 1. 교사 — 내 패드 홈

로그인하면 내가 만든 패드와 최근 방문한 패드를 한눈에 봅니다.

<img src="docs/screenshots/01-teacher-home.png" alt="교사 홈 화면 — 내가 만든 패드 카드 목록" width="900" />

### 2. 교사 — 패드 안에서 섹션·카드 정리

섹션(열)을 만들어 주제를 나누고, 카드나 섹션 헤더를 아무 곳이나 길게 누르면 순서를 바꿀 수 있습니다(모바일은 꾹 누르기, 데스크톱은 클릭한 채 살짝 끌기). 고정한 글은 항상 맨 위에 남습니다.

<img src="docs/screenshots/02-teacher-board.png" alt="패드 화면 — 섹션 3개와 카드들, 길게 눌러 순서 바꾸기 안내" width="900" />

### 3. 교사 — 새 카드 작성

섹션의 파란 `+` 버튼을 누르면 작성 창이 열립니다. 제목·본문은 브라우저에 자동 저장되고, 파일·사진·음성·링크를 함께 첨부할 수 있습니다.

<img src="docs/screenshots/03-teacher-composer.png" alt="게시물 작성 모달 — 제목, 본문, 파일 첨부, 촬영/녹음, 링크 첨부" width="900" />

### 4. 학생 — 같은 패드 보기

학생 계정으로 들어가면 같은 패드가 참여 권한에 맞춰 보입니다.

<img src="docs/screenshots/04-student-board.png" alt="학생 계정으로 본 같은 패드" width="900" />

### 5. 학생 — 카드 상세와 댓글

카드를 열면 독립된 상세 페이지(`/b/{slug}/posts/{postId}`)로 이동해 본문을 크게 읽고, 반응을 남기고, 댓글로 대화할 수 있습니다.

<img src="docs/screenshots/05-student-post-detail.png" alt="게시물 상세 페이지 — 본문과 댓글 영역" width="900" />

### 6. 전체관리자 — 관리자 센터

전체관리자는 별도 콘솔에서 사용자 계정·권한·소속, 교사 가입 승인, 감사 로그를 관리합니다(아래 화면은 실제 가입자 정보 노출을 막기 위해 데모 계정만 검색해 필터링한 상태입니다).

<img src="docs/screenshots/06-admin-panel.png" alt="관리자 센터 — 사용자 관리 화면(데모 계정만 표시)" width="900" />

### 7. 교사 — 게시물 작성: 파일·링크 첨부와 썸네일

작성 창에서 이미지·문서를 끌어놓아 첨부하거나, 링크를 한 줄에 하나씩 붙여넣고 **링크 추가**를 누르면 제목·대표 이미지를 자동으로 가져와 카드 형태로 미리 보여줍니다. 첨부와 링크는 합쳐서 게시물 하나에 최대 20개까지 붙일 수 있어요.

<img src="docs/screenshots/07-composer-attachments.png" alt="게시물 작성 모달 — 이미지 첨부와 링크 첨부가 채워진 상태" width="900" />

게시하면 업로드한 이미지는 자동으로 WebP로 변환되어 카드 맨 위에 **썸네일**로 나타나고, 링크는 사이트 이름·도메인이 붙은 미리보기 카드로 보입니다.

<img src="docs/screenshots/08-thumbnail-and-link-card.png" alt="보드에 반영된 이미지 썸네일 카드와 링크 미리보기 카드" width="900" />

### 8. 교사 — 카드와 열(섹션) 옮기기

카드나 섹션 헤더의 드래그 손잡이를 길게 누르면(모바일은 꾹 누르기, 데스크톱은 클릭한 채 살짝 끌기) 순서를 바꿀 수 있어요. 마우스 없이도 손잡이에 포커스한 뒤 스페이스바로 잡고, 방향키로 옮기고, 스페이스바로 다시 놓는 키보드 조작도 지원합니다.

<img src="docs/screenshots/09-card-drag.gif" alt="카드를 다른 섹션으로 드래그해 옮기는 과정" width="900" />

### 9. 교사 — 열(섹션) 추가·수정

패드 오른쪽 위 **섹션 추가**로 새 주제를 열 수 있고, 각 섹션의 `···` 메뉴에서 제목·안내 문구 수정이나 삭제를 할 수 있어요(제목을 더블클릭해도 바로 수정 창이 열립니다).

<img src="docs/screenshots/10-section-add.png" alt="새 섹션 열기 모달 — 섹션 제목과 안내 문구 입력" width="900" />
<img src="docs/screenshots/11-section-menu.png" alt="섹션 메뉴 — 수정, 삭제" width="900" />

열 순서 자체도 카드와 같은 방식(길게 누르기 또는 스페이스바+방향키)으로 바꿀 수 있습니다.

<img src="docs/screenshots/12-section-drag.gif" alt="섹션(열) 순서를 드래그해 바꾸는 과정" width="900" />

### 10. 교사 — 패드 설정

패드 오른쪽 위 설정 아이콘을 누르면 **기본 정보 · 공개·공유 · 외형 · 게시물 필드 · 참여·첨부 · 승인·동결 · 멤버** 7개 탭으로 나뉜 설정 패널이 열립니다. 외형 탭의 레이아웃에서 **담벼락 / 그리드 / 피드 / 타임라인 / 표 / 열**(섹션을 세로 열로 나눠 옆으로 배치) 중 고를 수 있고, 카드 크기·배경색·강조색·글꼴도 바꿀 수 있어요.

<img src="docs/screenshots/13-settings-appearance.png" alt="패드 설정 › 외형 — 레이아웃(열 포함), 색상, 글꼴" width="900" />

참여·첨부 탭에서는 멤버의 글쓰기·파일 업로드·댓글·반응 허용 여부와 첨부파일 다운로드 범위를, 멤버 탭에서는 같은 학교 구성원을 검색해 초대하고 역할(소유자·관리자·편집자·멤버·뷰어)을 바꿀 수 있습니다.

<img src="docs/screenshots/14-settings-participation.png" alt="패드 설정 › 참여·첨부 — 권한, 반응, 다운로드 범위" width="900" />
<img src="docs/screenshots/15-settings-members.png" alt="패드 설정 › 멤버 — 참여 멤버 목록과 멤버 추가 검색" width="900" />

### 11. 교사 — 패드 배경 이미지 = 홈 화면 카드 표지

기본 정보 탭에서 올리는 배경 이미지는 패드 안 배경으로도 쓰이고, **내 패드** 목록에서 그 패드를 나타내는 카드 표지(썸네일)로도 함께 사용됩니다. 업로드하면 최대 1920×1200 WebP로 자동 변환됩니다.

<img src="docs/screenshots/16-home-cover-thumbnail.png" alt="배경 이미지를 지정한 패드가 내 패드 목록에서 카드 표지로 보이는 모습" width="900" />

## 주요 기능

- **역할과 권한** — 학생·교사·전체관리자 역할, 학교·학급 소속, 보드별 소유자/관리자/편집자/멤버/뷰어 권한, 서명된 세션 쿠키
- **보드 편집** — 섹션·카드 생성/수정/정렬/소프트 삭제, 카드·섹션을 길게 눌러 순서 바꾸기(마우스는 거리 기준, 터치는 지연 기준으로 스크롤과 구분, 드래그 손잡이에 포커스해 스페이스바+방향키로도 조작 가능), 담벼락/격자/피드/타임라인/표/**열**(섹션을 세로 열로 나눠 옆으로 배치) 등 여러 레이아웃
- **보관함과 복구** — 글·댓글·섹션·패드는 삭제 후 7일간 복구할 수 있고, 첨부파일은 삭제 즉시 영구 정리
- **댓글·반응·멘션** — 답글 트리, 이모지 반응, 내부 사용자 멘션
- **첨부파일과 링크** — 스트리밍 업로드, 이미지 자동 WebP 변환·썸네일, Range 기반 다운로드, 업로드 시 매직바이트 검증으로 위조된 파일 형식 차단. 링크는 한 줄에 하나씩 붙여넣으면 제목·대표 이미지를 자동으로 가져와 미리보기 카드로 첨부(파일+링크 합쳐 게시물당 최대 20개)
- **패드 표지 이미지** — 패드 설정에서 올리는 배경 이미지가 패드 안 배경이자 내 패드 목록의 카드 표지(썸네일)로 함께 쓰임(최대 1920×1200 WebP로 자동 변환)
- **세분화된 패드 설정** — 기본 정보·공개 범위·외형(레이아웃/색상/글꼴)·게시물 필드(커스텀 질문)·참여 및 첨부 권한·게시 승인/패드 동결·멤버 역할 관리까지 7개 탭으로 구성
- **안전한 콘텐츠 렌더링** — `react-markdown` + `rehype-sanitize`로 게시물 본문을 안전하게 렌더링
- **실시간 갱신** — SSE 기반 보드 이벤트로 새로고침 없이 변경 사항 반영
- **내보내기** — CSV(수식 인젝션 방어 적용)·XLSX·첨부파일 ZIP, 인쇄용 뷰, 발표 모드
- **보안 기본기** — CSRF same-origin 검사, DB 공유형 IP·계정·조합별 로그인 제한, 인증 이벤트 집계, PII 암호화·마스킹, 보안 응답 헤더(CSP 등)

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프레임워크 | Next.js 16 (App Router), React 19, TypeScript |
| 데이터베이스 | PostgreSQL, Prisma ORM |
| 인증 | NextAuth (이메일 Credentials + 카카오 OAuth), scrypt |
| 드래그 앤 드롭 | @dnd-kit |
| 스타일 | Tailwind CSS 4, CSS Modules |
| 콘텐츠 렌더링 | react-markdown, rehype-sanitize |
| 파일 처리 | busboy, sharp, file-type |
| 내보내기 | exceljs, archiver |

## 처음부터 설치하기

Node.js나 PostgreSQL을 한 번도 안 써봤어도 따라 할 수 있도록, 이 프로젝트를 전혀 모르는 사람 기준으로 처음부터 끝까지 적었습니다. 이미 익숙하다면 [주요 기능](#주요-기능) 다음 표만 보고 바로 `yarn install && yarn dev`로 넘어가도 됩니다.

### 0. 준비물

| 도구 | 버전 | 확인 방법 |
|---|---|---|
| [Node.js](https://nodejs.org/) | 20 이상 (LTS 권장) | `node --version` |
| [Yarn](https://classic.yarnpkg.com/) | 1.22 (Classic) | `yarn --version` |
| [Git](https://git-scm.com/) | 아무 버전 | `git --version` |
| PostgreSQL | 14 이상 | 아래 [2단계](#2-postgresql-설치)에서 설치 |

Node.js는 [nodejs.org](https://nodejs.org/)에서 "LTS" 버전을 내려받아 설치 파일을 그대로 실행하면 됩니다(Windows/macOS 공통). 설치가 끝나면 터미널(Windows는 "명령 프롬프트"나 "PowerShell", macOS는 "터미널" 앱)을 열어 `node --version`을 쳐서 버전이 뜨는지 확인하세요.

### 1. 저장소 내려받기

```bash
git clone <이 저장소 주소>
cd pad
```

### 2. PostgreSQL 설치

이미 PostgreSQL이 있거나 Supabase·Neon·Railway 같은 클라우드 PostgreSQL을 쓸 계획이라면 이 단계는 건너뛰고 [3단계](#3-데이터베이스와-사용자-만들기)로 가세요(그 경우 서비스가 알려주는 연결 주소를 그대로 `DATABASE_URL`에 씁니다).

<details>
<summary><b>가장 쉬운 방법: Docker로 설치</b>(Docker가 이미 있다면 이 방법을 추천합니다)</summary>

```bash
docker run --name pyxcourse-postgres \
  -e POSTGRES_USER=pyxcourse \
  -e POSTGRES_PASSWORD=pyxcourse \
  -e POSTGRES_DB=pyxcourse \
  -p 5432:5432 \
  -d postgres:16
```

이 명령 하나로 설치와 데이터베이스 생성이 한 번에 끝납니다. 이후 `DATABASE_URL`은 `postgresql://pyxcourse:pyxcourse@localhost:5432/pyxcourse`가 됩니다. 컨테이너를 멈췄다가 다시 쓰려면 `docker start pyxcourse-postgres`.

</details>

<details>
<summary>Ubuntu / Debian (WSL 포함)</summary>

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql   # 부팅 시 자동 시작 + 지금 바로 시작
```

</details>

<details>
<summary>macOS (Homebrew)</summary>

```bash
brew install postgresql@16
brew services start postgresql@16
```

`brew`가 없다면 먼저 [brew.sh](https://brew.sh/)의 설치 명령을 터미널에 붙여넣어 Homebrew부터 설치하세요.

</details>

<details>
<summary>Windows</summary>

[postgresql.org 다운로드 페이지](https://www.postgresql.org/download/windows/)에서 설치 프로그램을 받아 실행합니다. 설치 중 물어보는 비밀번호(=`postgres` 사용자 비밀번호)를 기억해 두세요. 설치가 끝나면 시작 메뉴의 "SQL Shell (psql)"로 접속을 확인할 수 있습니다.

</details>

### 3. 데이터베이스와 사용자 만들기

(Docker 방법을 썼다면 이미 끝났으니 건너뛰세요.) PostgreSQL 접속 도구(`psql`)로 이 프로젝트 전용 사용자와 데이터베이스를 만듭니다.

```bash
sudo -u postgres psql
```

```sql
CREATE USER pyxcourse WITH PASSWORD 'pyxcourse';
CREATE DATABASE pyxcourse OWNER pyxcourse;
\q
```

(Windows에서 설치한 "SQL Shell (psql)"을 쓴다면 `sudo -u postgres psql` 대신 그냥 실행해서 설치할 때 정한 `postgres` 비밀번호로 접속한 뒤 같은 SQL 두 줄을 입력하면 됩니다.) 이제 연결 주소는 `postgresql://pyxcourse:pyxcourse@localhost:5432/pyxcourse`입니다 — 아래 5단계의 `DATABASE_URL`에 그대로 씁니다.

### 4. 패키지 설치

```bash
yarn install
```

### 5. 환경 변수(.env.local) 만들기

프로젝트 루트(이 README가 있는 폴더)에 `.env.local` 파일을 새로 만듭니다. `.env.example`을 복사해서 시작하면 편합니다.

```bash
cp .env.example .env.local
```

각 값을 아래 표대로 채웁니다.

| 변수 | 필수 | 설명 | 값 만드는 방법 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 연결 주소 | 2~3단계에서 만든 값, 예: `postgresql://pyxcourse:pyxcourse@localhost:5432/pyxcourse` |
| `NEXT_PUBLIC_APP_NAME` | | 화면·메타데이터·로그에 표시할 제품명 | 비우면 `pyxis`; 변경 후에는 개발 서버를 재시작해야 함 |
| `NEXTAUTH_URL` | ✅ | 이 앱이 실제로 열리는 주소 | 로컬 개발이면 `http://localhost:3001` 그대로 |
| `APP_ORIGINS` | ✅ | 상태 변경 API가 허용할 origin 목록 | 쉼표로 구분하며 프로토콜·호스트·포트를 모두 적음. 예: `http://localhost:3001,https://course.example.com` |
| `AUTH_SECRET` | ✅ | 로그인 세션을 서명하는 비밀키 | 터미널에서 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 실행해 나온 값 |
| `KAKAO_CLIENT_ID` | ✅ | 카카오 로그인 REST API 키 | [6단계](#6-카카오-로그인-앱-만들기) 참고 |
| `KAKAO_CLIENT_SECRET` | ✅ | 카카오 로그인 클라이언트 시크릿 | [6단계](#6-카카오-로그인-앱-만들기) 참고 |
| `PII_ACTIVE_KEY_ID` | ✅ | 아래 암호화 키 중 지금 쓸 키의 이름표 | 그냥 `v1`로 두면 됩니다 |
| `PII_ENCRYPTION_KEY_V1` | ✅ | 학생 이름·이메일 등을 암호화하는 키(base64, 32바이트) | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`를 **다시 한번 실행**해서 나온 값 |
| `PII_LOOKUP_KEY` | ✅ | 로그인 식별자·닉네임 중복 확인용 별도 키(base64, 32바이트) | 위 명령을 **또 한번** 실행 — `PII_ENCRYPTION_KEY_V1`과 반드시 다른 값이어야 합니다 |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | ✅ | 이 이메일로 카카오 로그인하면 자동으로 전체관리자가 됨 | 본인이 로그인할 카카오 계정 이메일 |
| `UPLOAD_DIR` | ✅ | 업로드 파일을 저장할 폴더 | 로컬 개발은 `./uploads`(자동 생성됨) |
| `MAX_UPLOAD_SIZE_MB` | | 첨부파일 1개 최대 용량(MB) | 비우면 기본값 30 |
| `IMAGE_PROCESSING_CONCURRENCY` | | 이미지 변환(WebP) 동시 처리 개수 | 비우면 기본값 2, 서버 사양이 낮으면 1 권장 |
| `TRUST_CLOUDFLARE_IP_HEADER` | | Cloudflare의 실제 IP 헤더 신뢰 | 원본 서버를 Cloudflare에서만 접근 가능하게 막은 배포에서만 `true` |
| `TRUST_X_FORWARDED_FOR` | | 자체 프록시의 전달 IP 신뢰 | 신뢰 프록시가 외부 입력을 덮어쓰고 원본 서버 직접 접근을 막은 경우만 `true` |

> `node -e "..."` 명령은 위에서 시킨 대로 **총 세 번** 실행해서(`AUTH_SECRET`, `PII_ENCRYPTION_KEY_V1`, `PII_LOOKUP_KEY`) 서로 다른 세 값을 넣어야 합니다. 같은 값을 복사해서 재사용하면 안 됩니다. `.env.local`은 절대 git에 커밋하지 마세요(이 저장소는 이미 `.gitignore`로 막아뒀습니다).

작성 예시:

```dotenv
DATABASE_URL="postgresql://pyxcourse:pyxcourse@localhost:5432/pyxcourse"
NEXT_PUBLIC_APP_NAME="pyxis"
NEXTAUTH_URL="http://localhost:3001"
APP_ORIGINS="http://localhost:3001"
AUTH_SECRET="여기에-node-명령으로-만든-값-1"
KAKAO_CLIENT_ID="카카오 개발자 콘솔에서 복사한 REST API 키"
KAKAO_CLIENT_SECRET="카카오 개발자 콘솔에서 복사한 클라이언트 시크릿"
PII_ACTIVE_KEY_ID="v1"
PII_ENCRYPTION_KEY_V1="여기에-node-명령으로-만든-값-2"
PII_LOOKUP_KEY="여기에-node-명령으로-만든-값-3"
BOOTSTRAP_SUPER_ADMIN_EMAIL="내카카오이메일@example.com"
UPLOAD_DIR="./uploads"
MAX_UPLOAD_SIZE_MB=30
IMAGE_PROCESSING_CONCURRENCY=2
TRUST_CLOUDFLARE_IP_HEADER=false
TRUST_X_FORWARDED_FOR=false
```

### 6. 카카오 로그인 앱 만들기

아이디·비밀번호 로그인만으로도 개발할 수 있습니다. 카카오 로그인도 함께 제공하려면 앱을 등록해 `KAKAO_CLIENT_ID`/`KAKAO_CLIENT_SECRET`을 준비합니다.

1. [Kakao Developers](https://developers.kakao.com/)에 카카오 계정으로 로그인합니다.
2. 상단 메뉴 **내 애플리케이션 → 애플리케이션 추가하기**로 앱을 하나 만듭니다(이름은 아무거나 괜찮습니다).
3. 만든 앱의 **앱 키** 탭에서 **REST API 키**를 복사해 `KAKAO_CLIENT_ID`에 붙여넣습니다.
4. 왼쪽 메뉴 **제품 설정 → 카카오 로그인**으로 들어가 "활성화 설정"을 켭니다.
5. 같은 화면의 **Redirect URI**에 `http://localhost:3001/api/auth/callback/kakao`를 등록합니다(운영 배포 시에는 실제 도메인으로 `NEXTAUTH_URL`을 바꾸고 이 주소도 같이 추가해야 합니다).
6. **제품 설정 → 카카오 로그인 → 보안** 탭에서 "Client Secret"을 생성하고 상태를 "사용함"으로 바꾼 뒤, 그 값을 `KAKAO_CLIENT_SECRET`에 붙여넣습니다.
7. **동의항목** 탭에서 "이메일"을 필수 동의로 설정합니다 — 이 앱은 이메일로 계정을 구분하므로 이메일 동의가 없으면 로그인이 막힙니다.

### 7. 데이터베이스 스키마 적용 + 데모 데이터

```bash
yarn db:generate   # Prisma 클라이언트 코드 생성
yarn db:migrate    # 위에서 만든 빈 데이터베이스에 테이블 생성
yarn db:backfill-nicknames # 기존 사용자 닉네임 HMAC 백필(새 DB는 0건)
yarn db:seed       # 학교·데모 교사/학생 계정 같은 기본 데이터 채우기
```

### 8. 개발 서버 실행

```bash
yarn dev
```

터미널에 `Ready`가 뜨면 브라우저에서 `http://localhost:3001`을 엽니다. 로그인 창의 **회원가입**에서 3~20자 영문·숫자 아이디를 중복 확인한 뒤 10자 이상이면서 영문자·숫자·특수문자를 포함한 비밀번호로 실제 계정을 만들 수 있고, 곧바로 고유 닉네임·학교·반/부서 설정으로 이어집니다. 학생은 즉시 완료되고 교사는 학교 대표교사 또는 전체관리자의 승인이 필요합니다. `BOOTSTRAP_SUPER_ADMIN_EMAIL`은 카카오가 검증한 같은 이메일로 처음 로그인할 때만 전체관리자를 만들며 일반 아이디 가입에는 적용되지 않습니다.

로그인 제한은 PostgreSQL에 저장되어 서버 재시작과 다중 인스턴스에서도 IP·계정·IP+계정 단위로 공유됩니다. Vercel에서는 플랫폼의 위조 방지 IP 헤더를 자동 사용합니다. 자체 프록시는 위 표의 신뢰 옵션을 켜기 전에 반드시 원본 서버 직접 접근을 차단해야 합니다. 운영 환경에서는 애플리케이션 제한에 더해 WAF에서 인증 경로의 IP별 속도 제한도 적용하세요.

> 운영 환경에 올릴 때는 `UPLOAD_DIR`을 컨테이너가 재시작돼도 사라지지 않는 영구 볼륨으로 지정하고 정기적으로 백업하세요. `DATABASE_POOL_MAX`(기본 10)로 Prisma 커넥션 풀 크기도 조정할 수 있습니다.

### 자주 겪는 오류

<details>
<summary><code>Can't reach database server</code> / DB 연결 실패</summary>

PostgreSQL이 실제로 떠 있는지 확인하세요.

```bash
# Ubuntu/Debian
sudo systemctl status postgresql
# macOS(Homebrew)
brew services list
# Docker
docker ps
```

`DATABASE_URL`의 사용자명·비밀번호·포트(기본 5432)가 실제 설정과 같은지도 다시 확인하세요.

</details>

<details>
<summary><code>PII_ACTIVE_KEY_ID 환경 변수가 설정되지 않았습니다</code> 같은 오류</summary>

`.env.local`에 `PII_ACTIVE_KEY_ID`, `PII_ENCRYPTION_KEY_V1`, `PII_LOOKUP_KEY` 세 값이 모두 채워져 있는지, 오타 없이 변수 이름이 정확한지 확인하세요(특히 `PII_ENCRYPTION_KEY_V1`은 `PII_ACTIVE_KEY_ID` 값이 `v1`일 때만 이 이름을 씁니다).

</details>

<details>
<summary>카카오 로그인 후 <code>redirect_uri mismatch</code></summary>

카카오 개발자 콘솔의 Redirect URI가 `NEXTAUTH_URL` + `/api/auth/callback/kakao`와 정확히 같은지 확인하세요(끝에 슬래시가 더 붙거나 http/https가 다르면 실패합니다).

</details>

<details>
<summary>포트 3001이 이미 사용 중</summary>

다른 프로그램이 3001 포트를 쓰고 있다면 `package.json`의 `"dev": "next dev --port 3001"`에서 포트 번호를 원하는 값으로 바꾸고, `NEXTAUTH_URL`과 카카오 Redirect URI도 그 포트에 맞게 같이 바꿔야 합니다.

</details>

## 검증 명령

```bash
yarn lint
yarn tsc --noEmit
yarn build
yarn audit
yarn verify:routes
yarn verify:form-editor-merge
yarn verify:pad-realtime
yarn verify:deploy
```

## 운영 배포

운영 PM2 앱(`pyxis`, 기본 포트 `3001`)이 실행 중일 때는 다음 명령으로 배포합니다.

```bash
yarn deploy
# 앱 이름이나 포트가 다르면 명시합니다.
PM2_APP=pyxis PORT=3001 yarn deploy
```

Blog의 `scripts/deploy.sh`와 같이 실행 중인 빌드에 손대지 않고 `.next-a`와 `.next-b`를 번갈아 빌드한 뒤 PM2를 전환합니다. 기존 `.next-prod`에서 첫 배포도 지원합니다. 실제 `server.ts` 프로세스의 환경을 확인하므로 PM2가 `yarn start`를 감시하는 구성에서도 현재 빌드를 정확히 찾습니다. `yarn build`와 `yarn start`의 기본 폴더는 `.next-prod`이고, `NEXT_DIST_DIR`을 주면 지정값을 사용합니다. 운영 서버가 `.next-prod`를 쓰는 동안 `yarn build`를 직접 실행하면 운영 파일을 덮어쓰므로 배포에는 `yarn deploy`를 사용하세요.

배포 잠금으로 동시 실행을 막고, 빌드 도중에는 이번 빌드의 생성 타입만 검사합니다. Next가 변경하는 `tsconfig.json`·`next-env.d.ts`는 성공·실패 모두 원상 복구합니다. 빌드 실패 시 운영 서버를 그대로 유지하고, 전환 후 새 빌드 고유 manifest와 홈페이지가 정상 응답하지 않으면 이전 빌드로 자동 복귀합니다. 성공한 PM2 환경은 `pm2 save`로 저장합니다. 전환 직전 빌드는 원래 폴더에 남고, 새 빌드로 교체할 비활성 폴더와 작업 전 설정은 로그에 표시되는 `/tmp/pyxis-deploy.*` 경로에 보존됩니다. DB 스키마 변경이나 소스 코드까지 자동 롤백하지는 않습니다.

이 방식은 **빌드 중 서비스 유지 + 짧은 단일 서버 재시작**입니다. 완전한 무중단 전환은 아니며 SSE·Socket.IO 연결은 전환 시 재연결됩니다. 패드 이벤트와 퀴즈 상태가 프로세스 메모리를 사용하므로 여러 서버를 동시에 서비스하는 방식은 별도 상태 공유 설계가 필요합니다.

## 문서 지도

화면·API·서버 모듈이 어떻게 이어지는지는 [`structure.md`](./structure.md), 폴더별 책임은 각 디렉터리의 `overview.md`를 참고하세요.
