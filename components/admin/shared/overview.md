# Admin shared components

admin 영역 안에서 둘 이상의 탭이 쓰지만 제품 전체 공용 UI는 아닌 요소입니다.

- `admin-pagination.tsx`: 사용자·학교·전체 리소스 목록의 페이지 크기, 페이지 번호 창, 이전/다음 이동을 통일합니다. 단순 승인 목록은 `AdminPageNavigation`의 compact 모드를 재사용합니다.
- `labels.ts`: 관리자 화면의 역할 라벨 정본입니다.

다른 제품 화면에서도 같은 동작이 필요해지면 `components/ui`로 승격하되, admin 전용 CSS 클래스나 권한 타입을 아는 동안에는 이 폴더에 둡니다.
