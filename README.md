<div align="center">

# pyxis

**교실에서 패드 · 퀴즈 · 설문을 한 계정으로 굴리는 수업 협업 플랫폼**

Next.js 16 (App Router) · React 19 · PostgreSQL · Prisma 7 · Socket.IO로 만들었습니다.

</div>

---

## 목차

- [소개](#소개)
  - [한눈에 보는 구성](#한눈에-보는-구성)
- [스크린샷으로 보는 패드 사용법](#스크린샷으로-보는-패드-사용법)
  - [1~6. 기본 화면 둘러보기](#1-교사--내-패드-홈)
  - [7. 게시물 작성 — 파일·링크 첨부와 썸네일](#7-교사--게시물-작성-파일링크-첨부와-썸네일)
  - [8. 카드와 열 옮기기](#8-교사--카드와-열섹션-옮기기)
  - [9. 열(섹션) 추가·수정](#9-교사--열섹션-추가수정)
  - [10. 패드 설정](#10-교사--패드-설정)
  - [11. 패드 배경 이미지 = 홈 화면 카드 표지](#11-교사--패드-배경-이미지--홈-화면-카드-표지)
- [학생 입장에서 본 pyxis](#학생-입장에서-본-pyxis)
  - [학생이 할 수 있는 일 한눈에 보기](#학생이-할-수-있는-일-한눈에-보기)
  - [메뉴별로 보이는 화면](#메뉴별로-보이는-화면)
- [주요 기능](#주요-기능)
  - [계정·소속·권한](#계정소속권한)
  - [패드](#패드)
  - [퀴즈](#퀴즈)
  - [설문](#설문)
  - [교과목·대시보드·리포트](#교과목대시보드리포트)
  - [공유와 참여](#공유와-참여)
  - [파일·첨부·문서 미리보기](#파일첨부문서-미리보기)
  - [알림과 실시간](#알림과-실시간)
  - [보안](#보안)
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
  - [9. (선택) 오피스 문서 미리보기 켜기](#9-선택-오피스-문서-미리보기-켜기)
  - [자주 겪는 오류](#자주-겪는-오류)
- [검증 명령](#검증-명령)
- [운영 배포](#운영-배포)
- [문서 지도](#문서-지도)

## 소개

pyxis는 학교 구성원이 **패드**에 글·첨부·댓글·반응을 모으고, **퀴즈**로 수업 활동을 진행하고, **설문**으로 응답을 받는 Next.js 기반 협업 서비스입니다. 세 기능은 같은 회원·학교·권한 계층 위에 있고, 세 곳의 활동이 공통 `Activity` 모델로 묶여 `/report` 한 화면에서 함께 보입니다.

로그인 아이디·비밀번호 또는 카카오로 시작할 수 있고, 학교·학급 단위 권한 관리와 학생 개인정보 암호화를 갖추고 있습니다. 링크와 QR만 있으면 로그인 없이도 패드에 글을 쓰고, 퀴즈에 PIN으로 참여하고, 설문에 응답할 수 있습니다.

### 한눈에 보는 구성

| 영역 | 주소 | 무엇을 하나 |
|---|---|---|
| 공개 홈 | `/`, `/guide` | 서비스 소개와 활용법. 로그인 없이 열리며 사용자·패드 DB를 조회하지 않습니다 |
| 통합 대시보드 | `/dashboard` | 로그인 후 기본 도착지. 퀴즈·패드·진행 중인 활동과 최근 방문을 함께 봅니다 |
| 패드 | `/pad`, `/b/{slug}` | 섹션·카드·댓글·반응. 6가지 레이아웃과 패드별 설정 7탭 |
| 퀴즈 | `/quiz/**`, `/j/{pin}` | 11가지 문항 유형, 실시간(LIVE)·과제(ASYNC) 세션, 채점과 리포트 |
| 설문 | `/forms/**`, `/s/{slug}` | 구글 설문지에 해당. 13가지 질문 유형 + 서명 필드, 응답 요약·XLSX 내보내기 |
| 교과목 | `/courses/**` | 학생 명단(개별 배정 ∪ 학급 연결)에 퀴즈·패드를 묶는 수업 단위 |
| 리포트 | `/report/**` | 퀴즈·패드·설문 활동을 `Activity` 한 테이블로 모아 보는 읽기 전용 화면 |
| 관리자 센터 | `/admin/**` | 학교 대시보드, 사용자·소속·대표교사, 학생 계정 발급, 가입/교사 승인, 감사 로그, 정책·테마 |
| 짧은 주소 | `/go/{별칭}` | 패드·퀴즈 세션·설문에 사람이 정한 별칭을 붙여 QR·칠판용 주소로 사용 |

## 스크린샷으로 보는 패드 사용법

아래 화면은 시드의 예시 학교·패드 데이터를 사용해 교사·학생·전체관리자 화면을 각각 점검한 스크린샷입니다. **패드 영역만 캡처되어 있습니다** — 퀴즈·설문·교과목·리포트 화면은 아래 [주요 기능](#주요-기능)의 글 설명을 참고하세요.

### 1. 교사 — 내 패드 홈

로그인하면 내가 만든 패드와 최근 방문한 패드를 한눈에 봅니다(`/pad`).

<img src="docs/screenshots/01-teacher-home.png" alt="교사 홈 화면 — 내가 만든 패드 카드 목록" width="900" />

### 2. 교사 — 패드 안에서 섹션·카드 정리

섹션(열)을 만들어 주제를 나누고, 카드나 섹션 헤더를 아무 곳이나 길게 누르면 순서를 바꿀 수 있습니다(모바일은 꾹 누르기, 데스크톱은 클릭한 채 살짝 끌기). 고정한 글은 항상 맨 위에 남습니다.

<img src="docs/screenshots/02-teacher-board.png" alt="패드 화면 — 섹션 3개와 카드들, 길게 눌러 순서 바꾸기 안내" width="900" />

### 3. 교사 — 새 카드 작성

섹션의 파란 `+` 버튼을 누르면 작성 창이 열립니다. 본문은 Markdown 입력을 편집 중 바로 시각화하는 CommonMark 편집기이고, 제목·본문은 브라우저에 자동 저장되며, 파일·사진·음성·링크를 함께 첨부할 수 있습니다.

<img src="docs/screenshots/03-teacher-composer.png" alt="게시물 작성 모달 — 제목, 본문, 파일 첨부, 촬영/녹음, 링크 첨부" width="900" />

### 4. 학생 — 같은 패드 보기

학생 계정으로 들어가면 같은 패드가 참여 권한에 맞춰 보입니다.

<img src="docs/screenshots/04-student-board.png" alt="학생 계정으로 본 같은 패드" width="900" />

### 5. 학생 — 카드 상세와 댓글

카드를 열면 독립된 상세 페이지(`/b/{slug}/posts/{postId}`)로 이동해 본문을 크게 읽고, 반응을 남기고, 댓글로 대화할 수 있습니다. 데스크톱은 본문·댓글 2단, 모바일은 1단이며 모바일에서는 댓글 버튼이 키보드 위에 붙는 하단 작성 시트를 엽니다.

<img src="docs/screenshots/05-student-post-detail.png" alt="게시물 상세 페이지 — 본문과 댓글 영역" width="900" />

### 6. 전체관리자 — 관리자 센터

전체관리자는 별도 콘솔에서 사용자 계정·권한·소속, 가입/교사 승인, 학생 계정 발급, 감사 로그를 관리합니다(아래 화면은 실제 가입자 정보 노출을 막기 위해 데모 계정만 검색해 필터링한 상태입니다).

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

## 학생 입장에서 본 pyxis

학생 계정으로 로그인해 메뉴를 하나씩 눌러 보며 정리한 내용입니다. 학생도 교사와 같은 상단 메뉴(**대시보드 · 퀴즈 · 패드 · 설문 · 리포트**)를 보지만, 각 메뉴의 첫 화면은 "내가 만든 것"보다 "내가 참여할 것" 위주로 바뀝니다.

### 학생이 할 수 있는 일 한눈에 보기

| 기능 | 학생 | 메모 |
|---|---|---|
| 패드 만들기 | ✅ 가능 | `/pad`의 **새 패드** 버튼. 기본 한도는 보관된 패드 포함 10개(교사 40개) |
| 패드에 글·댓글·반응 | ✅ 가능 | 패드 설정의 참여 권한을 따릅니다 |
| 퀴즈 만들기 | ✅ 가능 | 기본 한도 10개(교사는 무제한). 만들기 버튼 위치는 아래 참고 |
| 퀴즈 풀기 | ✅ 가능 | 할당받은 과제(ASYNC)를 이어 풀거나, PIN(`/j/{pin}`)으로 라이브에 참여 |
| 다른 교사의 공개 퀴즈 탐색(`/quiz/discover`) | ❌ 불가 | 학생은 `/quiz`로 돌려보냅니다 |
| 설문 만들기 | ❌ 불가 | 응답에 개인정보가 담기므로 `POST /api/forms`가 교사 이상만 허용합니다 |
| 설문 응답 | ✅ 가능 | `/s/{slug}` |
| 교과목 만들기·관리 | ❌ 불가 | 배정된 교과목을 모아 보기만 합니다 |
| 학생 기록 | 🔸 본인만 | 같은 학교 학생 전체가 아니라 자기 기록만 보입니다 |
| 생기부 문안(`/report/writeup`) | ❌ 불가 | "선생님용" 안내와 함께 내 기록으로 가는 버튼만 보입니다 |

> 학생 퀴즈·패드 한도는 관리자 센터 정책 탭(`SystemSetting.studentQuizLimit`·`studentBoardLimit`)에서 바꿀 수 있고, 퀴즈 한도를 `0`으로 두면 학생은 퀴즈를 만들 수 없습니다.

### 메뉴별로 보이는 화면

- **대시보드(`/dashboard`)** — 로그인하면 여기로 옵니다. 위에 퀴즈 활동 · 내 패드 · 내 설문 개수가 있고, 그 아래 **내 교과목** 필터(전체 과목 / 과목별)와 함께 내 퀴즈 · 내 패드 · 내 설문 카드가 과목별로 모입니다. 카드마다 "이어서 풀기", "패드 열기", "설문 응답" 같은 바로가기 버튼이 붙어 있습니다.
- **교과목(`/courses`)** — 사이드바의 **교과목**에서 배정된 과목 목록을 봅니다. 과목을 누르면 별도 관리 화면 대신 대시보드가 그 과목으로 필터된 상태(`/dashboard?subjectId=…`)로 열립니다.
- **퀴즈(`/quiz`)** — 첫 화면은 "MY LEARNING · 내 퀴즈"로, 할당받은 자율 풀이 과제와 참여한 라이브 퀴즈가 카드로 나옵니다(개인 과제 / 이어서 풀기). 사이드바에는 **내 퀴즈 · 즐겨찾기 · 할당 퀴즈**와 최근 방문이 있습니다.
  - **학생이 퀴즈를 만들려면** 사이드바의 **즐겨찾기**(`/quiz/favorites`)로 들어가면 오른쪽 위에 **새 퀴즈** 버튼과 `학생 퀴즈 한도 0/10` 표시가 보입니다. `/quiz/new`로 바로 들어가도 됩니다. 첫 화면(내 퀴즈)에는 만들기 버튼이 없습니다.
  - 만들기 화면은 교사와 같습니다 — 제목(최대 120자), 교과목(선택, 새 이름을 쓰면 자동 추가), 설명, 참여 방식(**학생 로그인** / **닉네임만 입력**).
- **패드(`/pad`)** — "내 패드" 목록에서 검색·정렬(최근 수정순/가나다순)과 **전체 · 참여한 패드 · 글쓰기 가능** 필터를 씁니다. 오른쪽 위 **새 패드**를 누르면 이름 · 한 줄 소개 · 교과목 · 공개 범위(비공개 / 링크 공개 / 전체 공개) · 초대 멤버를 정하는 창이 열립니다.
  - 남의 패드에 멤버로 들어가면 섹션 헤더의 `+`나 오른쪽 아래 `+` 버튼으로 글을 쓸 수 있습니다. 작성 창은 화면 오른쪽 패널로 열리고 제목(선택) · 내용 · 파일/이미지/촬영/링크 첨부(최대 20개)를 지원합니다.
  - 멤버에게는 패드 설정 아이콘이 없고, 오른쪽 위 `···` 메뉴에는 **패드 활동 기록 · 즐겨찾기 추가 · 삭제한 항목 · 내보내기·발표**만 있습니다. 섹션 순서 변경·섹션 수정도 할 수 없습니다.
- **설문(`/forms`)** — "MY LEARNING · 내 설문"으로, 수강 중인 교과목의 설문과 내가 응답한 설문이 보입니다. **새 설문** 버튼은 없습니다. 카드를 누르면 `/s/{slug}` 응답 화면이 열리고, 로그인 필수 설문은 "이 설문은 로그인 계정으로 응답합니다"라는 안내가 붙습니다.
- **리포트(`/report`)** — "활동 리포트"에 퀴즈 · 패드 · 설문 하위 메뉴가 있고, 내가 연 퀴즈 세션이나 만든 패드의 활동이 쌓입니다. **학생 기록**(`/report/students`)에서는 자기 자신 한 명만 보이며(퀴즈 응시 · 패드 글 · 설문 응답 수), 누르면 내 기록 상세로 이어집니다.

## 주요 기능

### 계정·소속·권한

- **두 가지 로그인** — 영문자·숫자 3~20자 아이디와 강한 비밀번호(10자 이상, 영문자·숫자·특수문자 포함), 또는 카카오 OAuth. 두 로그인 식별자는 공통 HMAC 조회값과 AES-GCM 암호문으로 보관합니다.
- **역할** — 학생 · 교사 · 전체관리자. 자가 가입과 최초 카카오 로그인 계정은 `PENDING`으로 만들어져 전체관리자 승인 뒤 온보딩으로 넘어갑니다. 교사 신청자는 학교 대표교사 또는 전체관리자의 승인을 받기 전까지 `STUDENT`로 유지됩니다.
- **학교 계층** — 학교 → 학년 → 반(CLASS)/부서(DEPARTMENT). 학생은 1~99 사이의 출석번호를 가지며 같은 반의 번호 중복은 DB 고유 인덱스가 막습니다. 학생도 패드와 퀴즈를 직접 만들 수 있고, 기본 소유 한도는 패드가 보관된 패드를 포함해 10개(교사 40개), 퀴즈가 10개(교사 무제한)입니다. 설문은 교사 이상만 만듭니다. 자세한 차이는 [학생 입장에서 본 pyxis](#학생-입장에서-본-pyxis)를 보세요.
- **학생 계정 일괄 발급** — 관리자가 학교·학년·반·번호·이름 XLSX 명단과 아이디 접두어를 올리면 학교 계층과 학생 계정이 한 번에 만들어집니다(예: 접두어 `ch`, 3학년 1반 6번 → `ch30106`). 초기 비밀번호는 평문으로 저장하지 않고 한 번만 전달하며, 첫 로그인은 `/change-password`로 제한됩니다.
- **보드별 권한** — 소유자 · 관리자 · 편집자 · 멤버 · 뷰어. 승인 상태는 JWT에 굳히지 않고 세션 갱신마다 DB에서 다시 계산합니다.

### 패드

- **레이아웃 6종** — 담벼락(WALL) · 그리드(GRID) · 피드(STREAM) · 타임라인(TIMELINE) · 표(TABLE) · 열(SECTIONS, 섹션을 세로 열로 나눠 옆으로 배치).
- **편집** — 섹션·카드 생성/수정/정렬/소프트 삭제, 길게 눌러 순서 바꾸기(마우스는 거리 기준, 터치는 지연 기준으로 스크롤과 구분), 드래그 손잡이 포커스 후 스페이스바+방향키 키보드 조작, 가장자리 자동 스크롤.
- **본문 편집기** — Milkdown CommonMark 편집기. 제목·인용·목록·코드 블록을 편집 중 바로 시각화하고, 저장은 기존과 같은 Markdown 문자열이라 과거 게시물과 호환됩니다. 상세 화면의 코드 블록은 가로 스크롤과 복사 버튼을 제공합니다.
- **첨부 배치** — 이미지·파일을 본문 문단 사이에 끼워 넣을 수 있습니다. 텍스트를 붙여넣을 때 앱이 HTML과 이미지를 함께 주더라도 텍스트를 우선하고, 클립보드가 파일만 담은 경우에만 첨부로 올립니다.
- **보관함과 복구** — 글·댓글·섹션·패드는 삭제 후 7일간 복구할 수 있고, 첨부파일은 삭제 즉시 영구 정리합니다.
- **댓글·반응·멘션** — 답글 트리, 이모지 반응(한 게시물에 하나/여러 개 중 선택), 내부 사용자 멘션. 로그인 사용자는 댓글에 이미지·음성·PDF를 최대 4개까지 붙일 수 있습니다.
- **설정 7탭** — 기본 정보 · 공개·공유 · 외형 · 게시물 필드(커스텀 질문) · 참여·첨부 · 승인·동결 · 멤버.
- **내보내기** — CSV(수식 인젝션 방어 적용) · XLSX · 첨부파일 ZIP, 인쇄용 뷰(`/b/{slug}/print`), 발표 모드(`/b/{slug}/present`), 패드 복제 링크(`/b/{slug}/copy`).

### 퀴즈

- **문항 유형 11가지** — 객관식(단일/복수) · O/X · 단답 · 순서 맞추기 · 수치 · 이미지 핀(채점형) 과 참여형 4종(설문형 · 워드클라우드 · 이미지 핀 모으기 · 리커트), 그리고 슬라이드.
- **두 가지 진행 방식** — **LIVE**: 교사가 세션을 열면 6자리 PIN이 생기고 학생이 `/j/{pin}`으로 들어와 Socket.IO로 실시간 진행합니다(대기실·순위·BGM·3·2·1 비프 포함). **ASYNC**: 학생에게 할당하면 기간 안에 각자 풀고 이어 풀 수 있습니다.
- **채점** — LIVE는 즉답 100%에서 제한시간 끝 30%까지 선형 감소, ASYNC는 고정 만점. 소켓 핸들러와 REST가 같은 채점 함수를 공유해 두 모드의 규칙이 갈라지지 않습니다. 재제출은 `(participantId, questionId)` 고유 제약이 막습니다.
- **보관함과 탐색** — 검색·교과목·상태·정렬 필터, 즐겨찾기, 복제, 교사 간 공유, 학생/학급 할당. 다른 교사의 공개 퀴즈는 `/quiz/discover`에서 찾아 복제합니다.
- **리포트** — 호스트는 참여자별 정답·평균 응답시간과 문항별 분포·오답자를, 학생은 자기 답안·정답·배점·응답시간을 봅니다.
- **문항 이미지** — DB에 base64로 넣지 않고 `UPLOAD_DIR/quiz/{quizId}/`에 파일로 저장하며, 저장하지 않고 떠난 이미지는 24시간 유예 뒤 자동 회수합니다.

### 설문

- **질문 유형 13가지 + 구역 제목** — 단답 · 장문 · 객관식 · 체크박스 · 드롭다운 · 선형 척도 · 별점 · 객관식 그리드 · 체크박스 그리드 · 날짜 · 시간 · 파일 업로드 · **서명**.
- **서명 필드** — `signature_pad`로 입력하고, 이미지가 아니라 0~1로 정규화한 좌표 JSON으로 저장합니다. 확대해도 깨지지 않아 인쇄에 유리하고 응답마다 파일이 생기지 않습니다.
- **응답 규칙** — 응답 확인(필수·형식·정규식)은 화면과 제출 API가 **같은 코드**를 씁니다. 1인 1응답은 `FormResponse.dedupeKey` 고유 제약으로 DB가 막고, 익명 응답자는 쿠키 토큰의 sha256만 저장합니다.
- **공개 응답 화면** — `/s/{slug}`. 로그인 필수 여부, 정원, 마감 시각, 마감 안내 문구를 설문마다 정합니다.
- **응답 확인** — 요약 · 질문별 · 개별 3탭과 XLSX 내보내기. VIEWER로 공유받은 사람도 응답을 볼 수 있습니다.

### 교과목·대시보드·리포트

- **교과목(`/courses`)** — 명단은 **개별 배정과 학급 연결의 합집합**입니다. 반을 통째로 연결하면 전학·반 이동이 자동 반영되고, 학생을 한 명씩 넣을 수도 있습니다. 교과목마다 학생·퀴즈·패드 탭이 있습니다. 학생은 배정된 교과목 목록만 보고, 과목을 누르면 대시보드가 그 과목으로 필터되어 열립니다.
- **대시보드(`/dashboard`)** — 퀴즈·패드 개수, 진행 중인 활동, 최근 방문(패드·퀴즈·설문 방문 시각을 합친 최신순)과 교과목 바로가기.
- **리포트(`/report`)** — 퀴즈·패드·설문 활동을 `Activity` 한 테이블에서 읽어 종류별 경로(`/report/quizzes`, `/report/pads`, `/report/forms`)로 나눠 봅니다. `/report/students`는 같은 학교 교사면 열 수 있는 읽기 전용 학생 기록이고(학생은 자기 기록만 보입니다), `/report/writeup`은 교사용 생활기록부 문안 화면입니다(문안 생성 자체는 아직 구현 전).

### 공유와 참여

- **손님(비로그인) 글쓰기** — 전체 공개 패드에 한해 교사가 켜면 로그인하지 않은 사람도 글과 사진을 올릴 수 있습니다. 패드를 열 때가 아니라 **글을 쓰려는 순간에만** 이름을 한 번 묻고, 계정을 만들지 않으며 이름은 보드별 HttpOnly 서명 쿠키에만 남습니다. 기본값은 **승인 후 공개**이고, 손님은 사진만(글당 5개·댓글당 4개) 첨부할 수 있습니다. 켜고 꺼도 패드 주소는 바뀌지 않습니다 — 이미 인쇄한 QR이 계속 살아 있어야 하기 때문입니다.
- **짧은 주소(`/go/{별칭}`)** — 패드·진행 중인 퀴즈 세션·설문에 영문 소문자·숫자·하이픈 3~40자의 별칭을 붙입니다. 원주소로 리다이렉트만 하므로 로그인·공개 범위·비밀번호 정책을 우회하지 않고, 변경·해제 뒤에도 과거 별칭은 예약 행으로 남아 다른 콘텐츠가 가져가지 못합니다.
- **QR과 초대 링크** — 퀴즈 참여 QR, 패드 초대 토큰(`/i/{token}`, 만료·사용 횟수 제한).
- **패드 공유 비밀번호** — 방문자 검증용 비동기 scrypt 해시와 소유자 재확인용 AES-GCM 암호문을 분리합니다. 원문 조회는 30분 이내 로그인한 소유자에게만 10분당 5회 허용하고 감사 로그를 남깁니다.

### 파일·첨부·문서 미리보기

- **스트리밍 업로드** — multipart 본문을 메모리에 올리지 않고 Busboy로 임시 파일에 흘려보냅니다. 확장자만 믿지 않고 파일 시그니처(매직바이트)를 검사합니다.
- **이미지** — JPEG·PNG·WebP·GIF를 방향 보정 후 최대 2560×2560 · 품질 82 WebP로 변환하고(원본은 남기지 않음), 카드용 썸네일은 960×960 · 품질 76으로 따로 만듭니다. 패드 배경 이미지는 1920×1200 WebP입니다.
- **미디어** — 영상 MP4·WebM·MOV, 음성 MP3·M4A·WAV·OGG·WebM. 트랜스코딩 없이 저장하고 Range 요청으로 재생합니다.
- **문서 미리보기** — PDF는 `pdfjs-dist` 뷰어로 바로 보고, 오피스 문서(pptx·docx·xlsx)는 rootless Podman 일회성 컨테이너에서 PDF로 변환해 보여 줍니다. 변환 이미지가 없으면 기능만 조용히 꺼지고 내려받기 카드는 계속 동작합니다. 파생 PDF 캐시는 `yarn viewer:prune-cache`로 정리합니다.
- **링크 첨부** — 한 줄에 하나씩 붙여넣으면 제목·대표 이미지를 가져와 미리보기 카드로 첨부합니다(파일+링크 합쳐 게시물당 최대 20개).

### 알림과 실시간

- **개인 알림** — 내 글에 댓글/반응, 내가 관리하는 보드에 새 멤버·접근 요청 도착, 내 접근 요청 승인/거절, 계정·교사 가입 신청과 승인/반려. 자기 행동에는 알림이 생기지 않고, 이미 그 보드를 보고 있으면 일반 보드 알림은 생략합니다.
- **패드 실시간** — SSE 기반 보드 이벤트로 새로고침 없이 변경 사항을 반영합니다. 탭이 숨겨지면 연결을 닫고 돌아올 때 다시 연결합니다.
- **퀴즈 실시간** — Socket.IO. 같은 포트에서 커스텀 서버(`server.ts`)가 Next 요청과 함께 처리합니다.

### 보안

- CSRF same-origin 검사, 요청마다 새 nonce로 발급하는 CSP와 고정 보안 헤더(HSTS · X-Frame-Options · nosniff · Referrer-Policy · Permissions-Policy).
- 로그인 시도 제한은 PostgreSQL(`AuthRateLimit`)에 저장해 재시작·다중 인스턴스에서도 IP·계정·IP+계정 단위로 공유되고, 실패가 반복되면 대기 시간이 늘어납니다. 인증 이벤트에는 식별자·IP 원문 대신 HMAC만 남깁니다.
- 쓰기 API는 same-origin → 요청량 제한 → 활성 세션 → Zod 입력 → 소속 → capability → 동결 상태 순으로 검사합니다. `proxy.ts`가 모든 쓰기 메서드에 계정당 분당 200회 백스톱을 걸고, 비용이 큰 라우트는 더 좁은 상한을 둡니다.
- 학생 이름·이메일 등 PII는 AES-GCM으로 암호화하고 조회용 HMAC만 별도로 둡니다. 비밀번호는 salt+scrypt 단방향 해시만 저장합니다.
- 게시물 본문은 `react-markdown` + `rehype-sanitize`로 안전하게 렌더링합니다.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 프레임워크 | Next.js 16.3 (App Router), React 19.3, TypeScript 5.9 |
| 서버 | 커스텀 Node 서버(`server.ts`) — Next 요청 처리와 Socket.IO가 같은 포트를 공유 |
| 데이터베이스 | PostgreSQL, Prisma 7 (멀티파일 스키마 `prisma/schema/**`) |
| 인증 | NextAuth 4 (아이디 Credentials + 카카오 OAuth), scrypt |
| 실시간 | 패드·알림은 SSE, 퀴즈는 Socket.IO 4 |
| 드래그 앤 드롭 | @dnd-kit |
| 스타일 | Tailwind CSS 4, CSS Modules, `--brand-h`/`--brand-c` 두 변수에서 파생되는 색 토큰 |
| 본문 편집 | Milkdown (CommonMark), react-markdown + rehype-sanitize |
| 파일 처리 | busboy, sharp, file-type, pdfjs-dist, Podman 기반 오피스→PDF 변환 |
| 입력 위젯 | signature_pad(서명), qrcode(참여 QR), html2canvas(인쇄 화면 PNG 저장) |
| 내보내기 | exceljs, archiver |
| 검증 | zod |

## 처음부터 설치하기

Node.js나 PostgreSQL을 한 번도 안 써봤어도 따라 할 수 있도록, 이 프로젝트를 전혀 모르는 사람 기준으로 처음부터 끝까지 적었습니다. 이미 익숙하다면 [5단계 환경 변수](#5-환경-변수envlocal-만들기) 표만 보고 바로 `yarn install && yarn dev`로 넘어가도 됩니다.

### 0. 준비물

| 도구 | 버전 | 확인 방법 |
|---|---|---|
| [Node.js](https://nodejs.org/) | 20.9 이상 (LTS 권장) | `node --version` |
| [Yarn](https://classic.yarnpkg.com/) | 1.22 (Classic) | `yarn --version` |
| [Git](https://git-scm.com/) | 아무 버전 | `git --version` |
| PostgreSQL | 14 이상 | 아래 [2단계](#2-postgresql-설치)에서 설치 |
| [Podman](https://podman.io/) | 선택 | 오피스 문서 미리보기를 쓸 때만. [9단계](#9-선택-오피스-문서-미리보기-켜기) |

Node.js는 [nodejs.org](https://nodejs.org/)에서 "LTS" 버전을 내려받아 설치 파일을 그대로 실행하면 됩니다(Windows/macOS 공통). 설치가 끝나면 터미널(Windows는 "명령 프롬프트"나 "PowerShell", macOS는 "터미널" 앱)을 열어 `node --version`을 쳐서 버전이 뜨는지 확인하세요.

### 1. 저장소 내려받기

```bash
git clone <이 저장소 주소>
cd pyxis
```

### 2. PostgreSQL 설치

이미 PostgreSQL이 있거나 Supabase·Neon·Railway 같은 클라우드 PostgreSQL을 쓸 계획이라면 이 단계는 건너뛰고 [3단계](#3-데이터베이스와-사용자-만들기)로 가세요(그 경우 서비스가 알려주는 연결 주소를 그대로 `DATABASE_URL`에 씁니다).

<details>
<summary><b>가장 쉬운 방법: Docker로 설치</b>(Docker가 이미 있다면 이 방법을 추천합니다)</summary>

```bash
docker run --name pyxis-postgres \
  -e POSTGRES_USER=pyxis \
  -e POSTGRES_PASSWORD=pyxis \
  -e POSTGRES_DB=pyxis \
  -p 5432:5432 \
  -d postgres:16
```

이 명령 하나로 설치와 데이터베이스 생성이 한 번에 끝납니다. 이후 `DATABASE_URL`은 `postgresql://pyxis:pyxis@localhost:5432/pyxis`가 됩니다. 컨테이너를 멈췄다가 다시 쓰려면 `docker start pyxis-postgres`.

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
CREATE USER pyxis WITH PASSWORD 'pyxis';
CREATE DATABASE pyxis OWNER pyxis;
-- 개발 중 `prisma migrate dev`로 스키마를 바꿀 계획이면 shadow DB 생성 권한도 줍니다.
ALTER USER pyxis CREATEDB;
\q
```

(Windows에서 설치한 "SQL Shell (psql)"을 쓴다면 `sudo -u postgres psql` 대신 그냥 실행해서 설치할 때 정한 `postgres` 비밀번호로 접속한 뒤 같은 SQL을 입력하면 됩니다.) 이제 연결 주소는 `postgresql://pyxis:pyxis@localhost:5432/pyxis`입니다 — 아래 5단계의 `DATABASE_URL`에 그대로 씁니다.

### 4. 패키지 설치

```bash
yarn install
```

### 5. 환경 변수(.env.local) 만들기

프로젝트 루트(이 README가 있는 폴더)에 `.env.local` 파일을 새로 만듭니다. `.env.example`을 복사해서 시작하면 편합니다.

```bash
cp .env.example .env.local
```

**꼭 채워야 하는 값**

| 변수 | 설명 | 값 만드는 방법 |
|---|---|---|
| `DATABASE_URL` | PostgreSQL 연결 주소 | 2~3단계에서 만든 값, 예: `postgresql://pyxis:pyxis@localhost:5432/pyxis` |
| `NEXTAUTH_URL` | 이 앱이 실제로 열리는 주소 | 로컬 개발이면 `http://localhost:3001` 그대로 |
| `APP_ORIGINS` | 상태 변경 API와 Socket.IO가 허용할 origin 목록 | 쉼표로 구분하며 프로토콜·호스트·포트를 모두 적음. 예: `http://localhost:3001,https://p.example.com` |
| `AUTH_SECRET` | 로그인 세션을 서명하는 비밀키 | 터미널에서 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` 실행해 나온 값 |
| `KAKAO_CLIENT_ID` | 카카오 로그인 REST API 키 | [6단계](#6-카카오-로그인-앱-만들기) 참고 |
| `KAKAO_CLIENT_SECRET` | 카카오 로그인 클라이언트 시크릿 | [6단계](#6-카카오-로그인-앱-만들기) 참고 |
| `PII_ACTIVE_KEY_ID` | 아래 암호화 키 중 지금 쓸 키의 이름표 | 그냥 `v1`로 두면 됩니다 |
| `PII_ENCRYPTION_KEY_V1` | 학생 이름·이메일 등을 암호화하는 키(base64, 32바이트) | 위 `node -e` 명령을 **다시 한번 실행**해서 나온 값 |
| `PII_LOOKUP_KEY` | 로그인 식별자·닉네임 중복 확인용 별도 키(base64, 32바이트) | 위 명령을 **또 한번** 실행 — `PII_ENCRYPTION_KEY_V1`과 반드시 다른 값이어야 합니다 |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | 이 이메일로 카카오 로그인하면 자동으로 전체관리자가 됨 | 본인이 로그인할 카카오 계정 이메일 |
| `UPLOAD_DIR` | 업로드 파일을 저장할 폴더 | 로컬 개발은 `./uploads`(자동 생성됨) |

> `node -e "..."` 명령은 **총 세 번** 실행해서(`AUTH_SECRET`, `PII_ENCRYPTION_KEY_V1`, `PII_LOOKUP_KEY`) 서로 다른 세 값을 넣어야 합니다. 같은 값을 재사용하면 안 됩니다. `.env.local`은 절대 git에 커밋하지 마세요(이 저장소는 이미 `.gitignore`로 막아뒀습니다).

**비워 두면 기본값을 쓰는 값**

| 변수 | 기본값 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | `pyxis` | 화면·메타데이터·로그에 표시할 제품명. 변경 후에는 개발 서버 재시작 필요 |
| `PORT` | `3001` | 커스텀 서버가 듣는 포트. Next 요청과 Socket.IO가 같은 포트를 씁니다 |
| `BIND_HOST` | 전체 인터페이스 | Cloudflare Tunnel 전용 배포는 `127.0.0.1`로 두어 원본 포트를 외부에 열지 않습니다 |
| `CLOUDFLARE_TUNNEL_ONLY` | `false` | 위 배포에서만 `TRUST_CLOUDFLARE_IP_HEADER`와 함께 `true` |
| `MAX_UPLOAD_SIZE_MB` | `30` | 첨부파일 1개 최대 용량. 실제 상한은 관리자 정책이 정본입니다 |
| `IMAGE_PROCESSING_CONCURRENCY` | `2` | 이미지 WebP 변환 동시 처리 수. 서버 사양이 낮으면 `1` 권장 |
| `IMAGE_PROCESSING_MAX_QUEUE` | `32` | 변환 대기열 상한. 가득 차면 새 업로드를 기다리지 않고 503으로 돌려보냅니다 |
| `MAX_QUIZ_IMAGE_STORAGE_MB` | `256` | 퀴즈 하나의 이미지 총량 |
| `QUIZ_IMAGE_SWEEP_INTERVAL_HOURS` | `6` | 미참조 퀴즈 이미지 정리 주기(업로드 후 24시간 보존) |
| `QUIZ_DELETED_PURGE_DAYS` | `90` | 삭제 퀴즈 영구 정리 기한. `0`이면 끔. 응시 세션이 있는 퀴즈는 항상 보존 |
| `MAX_SSE_CONNECTIONS` | `2000` | 프로세스 전체 SSE 동시 연결 상한(사용자당 보드 6개, 익명 버킷 60개는 별도) |
| `DATABASE_POOL_MAX` | `10` | Prisma 커넥션 풀 크기 |
| `TRUST_CLOUDFLARE_IP_HEADER` | `false` | Cloudflare의 실제 IP 헤더 신뢰. 원본 서버를 Cloudflare에서만 접근 가능하게 막은 배포에서만 `true` |
| `TRUST_X_FORWARDED_FOR` | `false` | 자체 프록시의 전달 IP 신뢰. 신뢰 프록시가 외부 입력을 덮어쓰고 원본 직접 접근을 막은 경우만 `true` |
| `DOCUMENT_CONVERTER_*`, `DOCUMENT_PREVIEW_CACHE_*` | `.env.example` 참고 | 오피스 문서 변환·캐시 설정. [9단계](#9-선택-오피스-문서-미리보기-켜기) |

> 관리 콘솔의 민감 작업 재인증 시간, 공개 퀴즈 요청·소켓 상한, 업로드 상한 같은 정책값은 환경 변수가 아니라 `/admin`의 정책 탭에서 정하며 `SystemSetting` 테이블이 정본입니다. 사이트 브랜드 색도 `/admin`의 테마 탭에서 정합니다(라이트·다크 선택은 사용자별 `pyxis-theme` 쿠키).

작성 예시:

```dotenv
DATABASE_URL="postgresql://pyxis:pyxis@localhost:5432/pyxis"
NEXT_PUBLIC_APP_NAME="pyxis"
PORT=3001
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
yarn db:generate                   # Prisma 클라이언트 코드 생성
npx prisma migrate deploy          # 기존 마이그레이션을 그대로 적용 (신규 설치는 이 명령)
yarn db:backfill-nicknames         # 기존 사용자 닉네임 HMAC 백필(새 DB는 0건)
yarn db:seed                       # 학교·데모 교사/학생 계정·예시 패드 채우기
yarn db:create-admin pyxadmin '여기에-강한-비밀번호'   # 아이디·비밀번호로 쓰는 전체관리자 계정
```

`yarn db:migrate`(= `prisma migrate dev`)는 **스키마를 직접 바꿀 때** 쓰는 개발용 명령이고 shadow 데이터베이스 생성 권한이 필요합니다. 권한이 없으면 `P3014`로 실패하니, 이미 있는 마이그레이션을 적용하기만 할 때는 위처럼 `prisma migrate deploy`를 쓰세요. 스키마 변경 SQL이 필요할 때는 `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script`로 뽑아 `prisma/migrations/`에 넣고 `migrate deploy`로 적용합니다.

기존 설치를 올리는 경우에는 `yarn db:backfill-profile-images`, `yarn db:backfill-quiz-images`, `yarn db:backfill-pii`, `yarn db:migrate-login-ids` 같은 일회성 백필 스크립트가 함께 있습니다. 새 DB에서는 실행할 필요가 없습니다.

`BOOTSTRAP_SUPER_ADMIN_EMAIL`은 **카카오가 검증한 같은 이메일로 처음 로그인할 때만** 전체관리자를 만듭니다. 카카오 앱을 등록하지 않았다면 위 `yarn db:create-admin`으로 만든 아이디 계정으로 `/admin`에 들어가세요.

### 8. 개발 서버 실행

```bash
yarn dev
```

터미널에 `Ready`가 뜨면 브라우저에서 `http://localhost:3001`을 엽니다. 로그인 창의 **회원가입**에서 3~20자 영문·숫자 아이디를 중복 확인한 뒤 10자 이상이면서 영문자·숫자·특수문자를 포함한 비밀번호로 계정을 만들 수 있고, 곧바로 고유 닉네임·프로필 사진·학교·반/부서 설정으로 이어집니다. 학생은 즉시 완료되고, 교사는 학교 대표교사 또는 전체관리자의 승인이 필요합니다. 자가 가입 계정 자체도 전체관리자의 가입 승인을 거칩니다.

시드가 만든 예시 패드는 전체 공개라 로그인 없이 `http://localhost:3001/b/career-exploration`에서 바로 열립니다.

로그인 제한은 PostgreSQL에 저장되어 서버 재시작과 다중 인스턴스에서도 IP·계정·IP+계정 단위로 공유됩니다. 자체 프록시는 위 표의 신뢰 옵션을 켜기 전에 반드시 원본 서버 직접 접근을 차단해야 합니다. 운영 환경에서는 애플리케이션 제한에 더해 WAF에서 인증 경로와 `/go/*`의 IP별 속도 제한도 적용하세요.

> 운영 환경에 올릴 때는 `UPLOAD_DIR`을 컨테이너가 재시작돼도 사라지지 않는 영구 볼륨으로 지정하고 DB와 함께 정기적으로 백업하세요. 첨부·아바타·퀴즈 이미지·라이브 오디오가 모두 이 폴더에 있습니다.

### 9. (선택) 오피스 문서 미리보기 켜기

pptx·docx·xlsx 첨부를 브라우저에서 바로 보려면 변환 컨테이너 이미지를 먼저 만듭니다.

```bash
yarn viewer:build-converter   # podman build (deploy/document-converter/Containerfile)
```

이미지가 없으면 미리보기 기능만 조용히 꺼지고 내려받기는 계속 동작합니다. 격리 없이 호스트의 LibreOffice를 쓰는 `DOCUMENT_CONVERTER_MODE=native`는 개발 호환용이며 명시적으로 지정해야만 켜집니다. 변환된 PDF 캐시는 `yarn viewer:prune-cache`로 정리하고, 운영에서는 `deploy/systemd/pyxis-viewer-cache.{service,timer}`로 매일 돌립니다.

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
<summary><code>P3014</code> — shadow 데이터베이스를 만들 수 없음</summary>

`prisma migrate dev`는 임시 shadow DB를 만들어야 해서 DB 사용자에게 데이터베이스 생성 권한이 필요합니다. `ALTER USER <사용자> CREATEDB;`로 권한을 주거나, 이미 있는 마이그레이션만 적용하면 되는 상황이라면 `npx prisma migrate deploy`를 쓰세요.

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
<summary>퀴즈 실시간 진행이 느리거나 순위가 늦게 갱신됨</summary>

CSP의 `connect-src`는 `APP_ORIGINS`에서 뽑은 호스트의 `ws://`·`wss://`만 허용합니다. `APP_ORIGINS`에 실제 접속 주소가 빠져 있으면 Socket.IO가 WebSocket으로 업그레이드하지 못하고 조용히 롱폴링으로 되돌아갑니다 — 기능은 살아 있고 지연만 늘어 알아채기 어렵습니다.

</details>

<details>
<summary>포트 3001이 이미 사용 중</summary>

`.env.local`의 `PORT`를 원하는 값으로 바꾸고, `NEXTAUTH_URL`·`APP_ORIGINS`와 카카오 Redirect URI도 그 포트에 맞게 같이 바꿔야 합니다.

</details>

## 검증 명령

기본 3종은 커밋 전에 항상 돌립니다.

```bash
yarn lint
yarn tsc --noEmit
yarn build        # 주의: 운영 서버가 .next-prod를 쓰는 중이면 직접 실행하지 말고 yarn deploy를 쓰세요
```

`scripts/`에는 도메인별 검증 스크립트가 51개 있습니다. 고친 영역에 해당하는 것을 함께 돌립니다.

| 영역 | 명령 |
|---|---|
| 라우트·경계 | `verify:routes` · `verify:api-boundaries` · `verify:performance` · `verify:seo` |
| 인증·가입·권한 | `verify:auth` · `verify:auth-password-ui` · `verify:approvals` · `verify:access` · `verify:access-request-notifications` · `verify:succession` |
| 패드 | `verify:pad-realtime` · `verify:pad-nav-layout` · `verify:pad-settings-members` · `verify:post` · `verify:post-content` · `verify:post-card-menu` · `verify:pagination` · `verify:board-create-options` · `verify:board-password-security` |
| 손님·공개 참여 | `verify:guest` · `verify:link-guest` · `verify:invite-redemption` · `verify:short-links` · `verify:public-quiz-limits` |
| 퀴즈 | `verify:quiz-save` · `verify:quiz-live` · `verify:quiz-assign` · `verify:quiz-images` |
| 설문 | `verify:forms-schema` · `verify:forms-save` · `verify:forms-submit` · `verify:forms-responses` · `verify:forms-followups` · `verify:form-editor-merge` · `verify:form-editor-autosave` · `verify:form-save-errors` · `verify:field-type-picker` · `verify:form-card-access` |
| 파일·업로드 | `verify:upload-policy` · `verify:multipart-limits` · `verify:export-limits` · `verify:link-preview` · `verify:profile-image` |
| 학생·명단·리포트 | `verify:roster` · `verify:roster-union` · `verify:student-reports` |
| 보안·실시간·배포 | `verify:security` · `verify:socket-payloads` · `verify:notifications` · `verify:http` · `verify:deploy` |

전체 목록은 `package.json`의 `scripts`에 있습니다. 상당수는 `DATABASE_URL`이 가리키는 DB에 실제로 읽고 쓰므로 **운영 DB가 아닌 개발 DB에서 실행하세요.**

정기 정리 작업도 같은 자리에 있습니다 — `yarn pad-trash:prune`(7일 지난 패드 휴지통), `yarn quiz-images:prune`(미참조 퀴즈 이미지), `yarn viewer:prune-cache`(문서 미리보기 캐시).

## 운영 배포

운영 PM2 앱(`pyxis`, 기본 포트 `3001`)이 실행 중일 때는 다음 명령으로 배포합니다.

```bash
yarn deploy
# 앱 이름이나 포트가 다르면 명시합니다.
PM2_APP=pyxis PORT=3001 yarn deploy
```

실행 중인 빌드에 손대지 않고 `.next-a`와 `.next-b`를 번갈아 빌드한 뒤 PM2를 전환합니다. 기존 `.next-prod`에서 첫 배포도 지원합니다. 실제 `server.ts` 프로세스의 환경을 확인하므로 PM2가 `yarn start`를 감시하는 구성에서도 현재 빌드를 정확히 찾습니다. `yarn build`와 `yarn start`의 기본 폴더는 `.next-prod`이고, `NEXT_DIST_DIR`을 주면 지정값을 사용합니다. 운영 서버가 `.next-prod`를 쓰는 동안 `yarn build`를 직접 실행하면 운영 파일을 덮어쓰므로 배포에는 `yarn deploy`를 사용하세요.

배포 잠금으로 동시 실행을 막고, 빌드 도중에는 이번 빌드의 생성 타입만 검사합니다. Next가 변경하는 `tsconfig.json`·`next-env.d.ts`는 성공·실패 모두 원상 복구합니다. 빌드 실패 시 운영 서버를 그대로 유지하고, 전환 후 새 빌드 고유 manifest와 홈페이지가 정상 응답하지 않으면 이전 빌드로 자동 복귀합니다. 성공한 PM2 환경은 `pm2 save`로 저장합니다. 전환 직전 빌드는 원래 폴더에 남고, 새 빌드로 교체할 비활성 폴더와 작업 전 설정은 로그에 표시되는 `/tmp/pyxis-deploy.*` 경로에 보존됩니다. DB 스키마 변경이나 소스 코드까지 자동 롤백하지는 않습니다.

이 방식은 **빌드 중 서비스 유지 + 짧은 단일 서버 재시작**입니다. 완전한 무중단 전환은 아니며 SSE·Socket.IO 연결은 전환 시 재연결됩니다.

운영 전제:

- **단일 앱 인스턴스가 기준입니다.** 첨부파일이 로컬 디스크(`UPLOAD_DIR`)에 있고 패드 SSE·퀴즈 세션 상태가 프로세스 메모리를 쓰므로, 여러 서버를 동시에 서비스하려면 공유 파일 저장소와 Redis 또는 PostgreSQL pub/sub 계층이 필요합니다.
- 참고 설정 파일은 `deploy/`에 있습니다 — `deploy/pm2/ecosystem.config.cjs`, `deploy/document-converter/Containerfile`, `deploy/systemd/pyxis-viewer-cache.{service,timer}`.
- Cloudflare Tunnel 뒤에 두는 배포는 `BIND_HOST=127.0.0.1` · `CLOUDFLARE_TUNNEL_ONLY=true` · `TRUST_CLOUDFLARE_IP_HEADER=true`를 함께 설정해 원본 포트를 외부에 열지 않습니다.
- DB와 `UPLOAD_DIR`을 함께 백업해야 합니다. 한쪽만 복구하면 첨부가 깨집니다.

## 문서 지도

| 문서 | 담는 내용 |
|---|---|
| [`overview.md`](./overview.md) | 제품 전체 개요 — 계정·소속, 손님 글쓰기, 패드 편집·공유, 주요 영역과 렌더링 원칙 |
| [`structure.md`](./structure.md) | 화면·API·서버 모듈·데이터 모델의 연결. 페이지 진입점 표, 대표 상호작용 흐름, 디자인 토큰, 운영 전제 |
| 각 폴더의 `overview.md` | 폴더별 책임과 그렇게 만든 이유(`lib/forms`, `lib/quiz`, `lib/files`, `components/pad` 등) |
| `mdFiles/` | 진행 중인 작업 현황(`report.md`)과 기능별 계획 문서 |
