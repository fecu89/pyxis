# Overview

퀴즈 화면의 Client Component 모음입니다. quiz 프로젝트에서 이식했습니다.

- `quiz-editor.tsx`: 문항 편집기. 유형별 입력(객관식·OX·단답·순서·수치·이미지 핀·설문·워드클라우드·리커트·슬라이드), 정렬, 발행.
- `quiz-library.tsx`: 보관함 목록. 검색·과목·상태·정렬 필터, 즐겨찾기, 복제, 공유, 학생 할당, 세션 생성. 교과목 구성은 대시보드가 담당합니다. 공유·할당 다이얼로그(`ShareDialog`/`AssignmentDialog`)는 예전엔 이 파일 안에 Tailwind로 직접 재구현한 로컬 `Modal`(포커스 트랩·ESC 처리를 자체 구현)을 썼지만, 지금은 패드 설정·생성 모달과 같은 공용 `components/ui/modal.tsx`를 씁니다. 다이얼로그 폭은 그 컴포넌트의 `className`으로 `app/globals.css`의 `.modal-panel.modal-md`/`.modal-lg`를 넘겨 조정합니다 — `.modal-panel`이 `width`를 이미 500px로 고정해 두어 Tailwind `max-w-*` 유틸은 실제로는 안 넓혀집니다. 두 다이얼로그의 후보 선택 UI도 `components/ui/selectable-list.tsx`의 공용 `SelectableList`/`PagedSelectableList`로 옮겼고, 전량을 미리 내려받는 방식은 사라졌습니다. `AssignmentDialog`는 예전엔 관리 가능한 학생을 최대 500명까지 모달을 열자마자 통째로 내려받았지만, 지금은 `?view=classes`로 학급 필터 옵션만 먼저 받고(모달을 여는 순간 학생 조회는 0회) 학급을 고르거나 검색어를 입력해야(`deferLoad`+`ready`) `lib/quiz/assign-candidates.ts`/`lib/users/student-search.ts`가 학급·검색·50명 페이지로 후보를 내려줍니다. `ShareDialog`는 여전히 공유 후보 교사(같은 학교, 최대 300명)를 `GET .../shares` 한 번에 받지만, 그 뒤 검색은 서버를 다시 부르지 않고 `SelectableList selectionMode="single"`로 클라이언트에서 이름·마스킹 로그인 식별자를 걸러 한 명만 고릅니다 — 재클릭하면 해제되고, 이미 공유 중인 교사도 후보에서 빠지지 않고 배지만 붙습니다(POST가 upsert라 다시 골라 권한을 바꿀 수 있어야 합니다). 모달을 닫거나 조회 조건을 바꿀 때 공유·학급·학생 후보 GET은 `AbortController`로 취소합니다.
- 보관함의 페이지 셸, 48px 검색·필터 도구, 상태 칩과 그룹 간격은 패드·설문과 `components/ui/content-library.module.css`를 공유합니다. 카드 표면·4→3→2→1 그리드·배지·`…` 메뉴는 Pad 기준의 `components/ui/content-card.tsx`와 `content-card-menu.tsx`를 사용합니다. 퀴즈는 교과목 강조색·권한별 메뉴 액션·세션 실행을 공용 카드에 전달합니다.
- 보관함 카드와 세션 결과의 반복 상세 링크는 자동 prefetch를 끕니다. 한 페이지에 보이는 모든 퀴즈 편집기·세션 화면의 RSC를 접속 직후 동시에 받지 않고 클릭한 항목만 로드합니다. `/quiz/activities`와 `/quiz/assignments`도 30개씩 서버 페이지네이션해 누적 이력을 한 번에 직렬화하지 않습니다.
- `play-session.tsx` / `live-game-ui.tsx` / `live-leaderboard.tsx`: 학생 풀이 화면과 진행 UI.
- `live-audio-controller.tsx`: 라이브 장면과 소켓 이벤트를 관리자 지정 BGM·효과음에 연결합니다. 대기실/진행 BGM 전환, 서버 절대시각 기준 3·2·1 비프, 시작·순위·종료 신호, 전역으로 합친 점수 카운트업 비프, 자동재생 해제와 탭 비활성 시 정지를 담당합니다. 점수 UI는 작은 `live-audio-context.tsx`만 의존해 편집기 미리보기 청크가 전체 오디오 엔진을 끌어오지 않습니다.
- `image-pin.tsx` / `numeric-dial.tsx` / `sortable-order-answer.tsx`: 유형별 답안 위젯.
- `participation-views.tsx` / `session-results-list.tsx` / `host-session-report.tsx` / `self-session-report.tsx`: 참여형 집계와 리포트.
- `quiz-session-launcher.tsx` / `join-session-card.tsx` / `join-qr-code.tsx` / `async-session-manager.tsx`: 세션 생성·참여 진입. 호스트와 비동기 세션 관리자는 참여 QR 아래 공용 `ShortLinkManager`로 `/go/{slug}` 별칭을 관리하며, 끝난 세션은 별칭을 만들 수 없고 세션 마감 트랜잭션이 기존 별칭도 삭제합니다.
- `icons.tsx`: quiz가 쓰던 인라인 SVG 아이콘. pad는 lucide-react를 쓰므로 통합 대상입니다.

alert/confirm/prompt 다이얼로그는 `components/ui/app-dialog.tsx`의 `DialogProvider` 하나로 합쳤습니다(`useDialog()`). 예전에 여기 있던 `app-dialog.tsx`와 pad의 `ConfirmProvider`가 루트 레이아웃에 함께 걸려 있던 구조는 없어졌습니다.

## 보관함의 필터가 있는 곳

`quiz-library.tsx`는 **자체 사이드바를 갖지 않습니다.** 예전에는 quiz가 독립 앱이던 시절의 `LibrarySidebar`가 남아 있어, pad 셸의 `AppSidebar`와 나란히 화면에 aside가 둘이었습니다. 지금은 이렇게 나뉩니다.

| 무엇 | 어디 | 왜 |
|---|---|---|
| 내 퀴즈·즐겨찾기·진행 기록·학생 할당·퀴즈 탐색 | 셸 사이드바의 평면 메뉴 | 서로 다른 목적지인 항목만 패드 사이드바와 같은 밀도로 둡니다. 즐겨찾기 개수는 `usePublishNavCounts`로 올립니다 |
| 할당 중·미할당과 발행·초안·참여 방식 | 본문 필터 칩 | 같은 보관함 안의 필터를 사이드바와 중복하지 않습니다 |
| 최근 방문한 퀴즈 6개 | 셸 사이드바 하단 | `QuizVisit.lastVisitedAt` 순으로 표시하며 퀴즈 수정만으로 순서가 바뀌지 않습니다 |
| 퀴즈 탐색 | 셸 사이드바의 퀴즈 섹션 항목 | 보관함과 데이터 범위가 달라 `/quiz/discover` 독립 라우트로 분리했습니다 |
| 교과목 관리 | `/dashboard`의 교과목 영역 | 퀴즈뿐 아니라 패드와 학생까지 한 수업 단위로 구성합니다 |
| 교과목 필터 | 본문 상단 드롭다운 | 과목은 개수가 무한히 늘 수 있어 사이드바에 세우면 목록이 끝없이 길어집니다 |
| 학생 퀴즈 한도 게이지 | 본문 상단, 새 퀴즈 버튼 옆 | 한도가 걸리면 비활성화되는 대상이 그 버튼입니다 |

퀴즈 보관함의 고정 보기는 `/quiz/favorites`, `/quiz/assigned`, `/quiz/unassigned` 정식 경로이고 검색·과목·상태·정렬·페이지 번호를 쿼리로 유지합니다. 예전 `/quiz/drafts`는 본문의 상태 필터와 같은 `/quiz?status=DRAFT`로 이동합니다. 공개 탐색은 `/quiz/discover`입니다. 예전 `?view=`·`?tab=discover` 주소도 렌더 전에 새 경로로 리다이렉트합니다. 이 목록 경로들은 `(library)` layout을 공유하며 탐색 페이지는 내 보관함의 즐겨찾기·할당·초안·교과목 집계를 조회하지 않습니다. 교과목 생성·수정·학생 배정은 `/courses`에서 처리합니다.

## 편집기와 세션의 첫 데이터

퀴즈 편집기, 호스트 콘솔과 학생 참여 화면은 마운트 뒤 문서나 세션을 다시 fetch하지 않습니다.
Server Component가 권한을 확인하고 `lib/quiz/editor-data.ts` 또는 `lib/quiz/session-data.ts`의 공용
로더로 초기 DTO를 전달합니다. 업로드 정책도 편집기 서버 페이지가 함께 전달하므로 이미지 상한을
알기 위한 별도 초기 요청이 없습니다. 이후 fetch는 저장·발행·답안 제출처럼 실제 사용자 작업에만
사용합니다. LIVE 호스트의 참여자 입·퇴장은 소켓 델타로 로컬 명단에 병합하므로 이벤트마다 세션 전체를
REST로 다시 읽지 않습니다.

## LIVE 실시간 확장 경계

학생과 호스트는 같은 세션 room에서 문항·공개·순위·종료 이벤트를 받지만, 참여자 입·퇴장·답안 수·진행 중
참여형 집계는 `session:{id}:hosts` 호스트 전용 room으로만 보냅니다. 학생 100명이 답할 때 학생 100명에게
호스트용 집계를 다시 fan-out하지 않습니다. 호스트는 입장 ACK에서 명단 정본을 한 번 받고, ACK를 기다리는
동안 먼저 도착한 참여자 델타는 ID 기준으로 보존해 늦은 스냅샷이 되돌리지 못하게 합니다.

한 반이 동시에 입장할 때 같은 세션 전문과 종료 순위를 읽는 진행 중 Promise를 공유하되 완료된 결과는
캐시하지 않아 다음 상태 변경을 가리지 않습니다. 답안 경로는 현재 문항 검증에 이미 읽은 채점 필드를
`gradeAndRecordAnswer()`에 넘겨 문항 SELECT를 반복하지 않습니다. 재접속 ACK에는 현재 문항·공개·순위와
종료된 세션의 최종 TOP 3가 포함되어 전체 페이지 새로고침 없이 화면이 서버 상태로 수렴합니다.

## 몰입 화면의 색

진행·풀이 화면(`play-session`, `live-game-ui`, `live-leaderboard`, 답안 위젯들)도 pad의 브랜드·상태 토큰을 사용합니다. 항상 어두운 라이브 무대는 테마에 따라 뒤집히는 면 토큰 대신 고정 명도 스케일을 쓰고, 정답 선택지·순위 메달처럼 서로 구분해야 하는 범주색만 기능색으로 유지합니다.

## LIVE 문항 시퀀스·리더보드 애니메이션

`live-game-ui.tsx`의 `QuestionSequenceStage`는 지금이 배수 인트로·카운트다운·읽기 중 어느 단계인지를
직접 판정하지 않고 `lib/quiz/question-sequence.ts`의 `sequenceStageAt()`(순수 함수)에 맡깁니다. 1배
문항은 이 함수가 애초에 `MULTIPLIER_INTRO`를 반환하지 않으므로, hydration 첫 프레임에도 `×1`이
잠깐 나타나는 일이 없습니다. 카운트다운 3·2·1 숫자도 `countdownStepAt()`으로 계산해 `850`을 여기
저기 다시 적지 않습니다(공용 상수는 `COUNTDOWN_STEP_MS`).

`live-leaderboard.tsx`의 카드는 `entry.participantId`만으로 key를 고정합니다(예전에는 `participantId:score`라
점수가 바뀔 때마다 카드 DOM 전체가 새로 만들어져 "이동"이 아니라 "교체"로 보였습니다). 순위가 바뀌면
먼저 이전 자리(`previousRank`)에 그리고, 다음 프레임에 새 자리(`rank`)로 CSS `transform`을 전환합니다
(FLIP 기법). 서버가 내려주는 리더보드가 현재·이전 TOP 3의 합집합(최대 6명, `lib/quiz/live-leaderboard.ts`)이라
밀려난 이전 3위도 한 번은 화면에 실려 3행 아래로 빠지는 모습을 그릴 수 있습니다.

이 두 화면이 쓰는 keyframe·클래스(`sequence-*`, `animate-game-pop`, `animate-answer-card`,
`live-leaderboard-*`)는 모두 `app/globals.css`의 "LIVE quiz motion" 섹션 한곳에 모여 있습니다 — 새
클래스를 쓰기 전에 반드시 그 섹션에 정의를 먼저 추가해야 합니다(정의가 없어도 에러 없이 그냥
무스타일이 되는 Tailwind 4의 특성 때문에 실제로 이 문제가 있었습니다).

## LIVE 오디오

라이브 오디오 설정은 `SystemSetting.quizLiveAudio` 한 묶음에 메타데이터만 저장하고 실제 파일은
`UPLOAD_DIR/system/quiz-live-audio`에 둡니다. 호스트·학생 Server Component가 공개 DTO를 처음 한 번
전달하며, 음원 바이트는 Socket.IO payload가 아니라 버전이 붙은 `/api/quiz/live-audio/[slot]`에서
range 응답과 immutable 캐시로 받습니다. 소켓은 이미 존재하는 퀴즈 단계 이벤트만 전달하므로 오디오를
추가해도 100명 방의 실시간 payload 크기는 늘지 않습니다. 공개 설정 조회는 프로세스에서 30초 캐시하고
동시에 들어온 첫 조회의 진행 중 Promise도 공유하므로, 한 반이 한꺼번에 입장해도 같은 설정 SELECT를
100번 시작하지 않습니다. 관리자 변경은 generation을 올려 진행 중이던 낡은 조회가 캐시를 덮지 못하게 합니다.
관리자가 수업 중 파일을 교체해도 기존 revision의 후속 range가 끊기지 않도록 최근 교체본 14개를 유예하고,
상한 밖 파일만 트랜잭션 커밋 뒤 삭제합니다.

`QuizLiveAudioController`의 시작·TOP 3·종료 효과음 카운터는 `question:sequence/show`,
`leaderboard:show`, `session:ended`의 실제 브로드캐스트에서만 증가합니다. 재접속의 `session:join`
스냅샷은 화면만 복원하고 지난 효과음을 반복하지 않습니다. 카운트다운만 현재 절대시각의 숫자를 한 번
따라잡습니다. 점수 숫자 컴포넌트가 여러 개여도 공유 컨텍스트에서 90ms로 제한해 효과음 객체와 재생
호출이 프레임 수만큼 불어나지 않습니다. 브라우저가 자동재생을 거부하면 화면 오른쪽 아래 버튼으로
사용자 입력에서 다시 시작하며, 음소거 선택은 브라우저에 보존됩니다.
장면·revision 변경이나 언마운트 때는 이전 `Audio`의 `src`를 제거하고 `load()`해 브라우저 미디어 버퍼도
해제합니다.

## 클라이언트 청크 경계

- `quiz-editor-preview.tsx`는 실제 `play-session.tsx`와 `live-game-ui.tsx`를 재사용하지만, 편집기의 정적 import가 아닙니다. 교사가 미리보기를 열 때만 이 청크와 `socket.io-client`를 받습니다. 이미지 핀의 정답 영역 캔버스도 같은 이유로 동적 import이며, 목록에 필요한 `pinAreaLabel()`은 순수 모듈 `lib/quiz/image-pin.ts`로 옮겼습니다.
- `play-session.tsx` 안에서도 `socket.io-client`는 type-only 정적 import와 LIVE 마운트 시 동적 import로 나뉩니다. 같은 참여 라우트를 쓰는 ASYNC 과제는 양방향 연결이 필요 없으므로 Socket.IO 런타임 청크를 받지 않습니다.
- `quiz-session-launcher.tsx`는 카드의 발행 버튼 상태만 가볍게 갖습니다. 날짜·진행 방식·제출 상태가 있는 `quiz-session-dialog.tsx`는 포인터/포커스 의도에서 미리 받고 실제로 연 카드 한 장에만 마운트합니다. 카드 수만큼 모달 상태 훅을 만들지 않습니다.
- 보관함의 `SelectableList`/`PagedSelectableList`와 카드 메뉴의 `CourseSelect`는 공유·할당·메뉴를 열기 전에는 필요하지 않아 동적 청크로 둡니다. 반복 카드 상세 링크의 `prefetch={false}`와 함께 목록 첫 진입에서 파생 라우트와 선택 UI를 한꺼번에 받지 않게 합니다.
