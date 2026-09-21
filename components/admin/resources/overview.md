# Admin resource managers

플랫폼 전체 패드·퀴즈·설문을 조회하는 관리자 전용 화면입니다.

- `board-manager.tsx`, `quiz-manager.tsx`, `form-manager.tsx`: 리소스별 열과 API 응답만 담당합니다.
- `resource-manager-ui.tsx`: 세 화면이 공유하는 검색·소유자·날짜·보관 필터와 정렬 헤더입니다.
- `resource-manager-query.ts`: 필터를 관리자 API 쿼리 문자열로 직렬화합니다.

목록 요청은 각 관리기가 AbortController 수명 주기를 소유합니다. 공용 UI는 API 경로와 응답 DTO를 알지 않으며, 리소스별 화면은 검색 폼·정렬 아이콘·쿼리 규칙을 다시 구현하지 않습니다.

데스크톱은 정렬 가능한 표를 유지합니다. 640px 이하에서는 각 셀의 `data-label`을 이용해 제목·소유자·상태·개수·수정일을 카드형 행으로 바꾸며 페이지 전체 가로 스크롤을 만들지 않습니다. 제목 검색은 명시적인 검색 버튼을 제공하고, 소유자·수정일·보관 필터는 모바일에서 필요할 때만 펼칩니다.
