# SEO 유틸 개요

blog 프로젝트의 `utils/seo/getMetadata.tsx`에서 canonical, Open Graph, Twitter, robots를 한곳에서
조립하는 패턴만 가져왔습니다. blog 전용 다국어·광고 설정은 pad에 포함하지 않습니다.

- `getMetadata.tsx`: 사이트 URL을 `NEXT_PUBLIC_URL` → `NEXTAUTH_URL` → Vercel URL 순서로 정규화하고,
  canonical·기본 키워드·OG/Twitter 1200×630 이미지·파비콘·manifest를 일관되게 만듭니다.
- `boardMetadata.ts`: 패드 메타데이터의 개인정보 경계입니다. 비밀번호 없는 LINK와 익명 읽기가 가능한
  PUBLIC만 제목·설명·색상·게시물 수를 반환합니다. LINK는 공유 미리보기는 제공하지만 `noindex`이고,
  검색 색인은 PUBLIC만 허용합니다. PRIVATE, 로그인 필요, NO_ACCESS, 비밀번호 보호 패드는 제목조차
  반환하지 않고 pyxis 기본 정보와 기본 썸네일을 사용합니다. 공개 가능한 패드는 OG 이미지에 실제로
  그려지는 제목·설명·공개 범위·레이아웃·색상·게시물 수를 해시한 12자리 버전을 이미지 경로에 붙입니다.
  내용이 같으면 동일 URL과 캐시를 재사용하고, 표시 내용이 바뀌면 새 URL이 되어 메신저의 오래된
  미리보기 캐시를 우회합니다.
- `app/sitemap.ts`: 홈·활용법과 함께 **익명 읽기 가능한 PUBLIC 패드 및 그 안의 PUBLISHED 게시물**을
  동적으로 나열합니다. `boardMetadata.ts`의 `INDEXABLE_PUBLIC_BOARD_WHERE`를 공유해 LINK·PRIVATE·
  로그인 필요·비밀번호·NO_ACCESS 패드가 사이트맵으로 새지 않게 하며 한 시간마다 갱신합니다.
  퀴즈 PIN은 종료 뒤 재사용되는 임시 주소이고, 설문은 아직 `익명 응답 가능`과 `검색 공개`를 구분하는
  설정이 없으므로 둘 다 사이트맵에서 제외하고 페이지의 `noindex`를 유지합니다.
- `openGraphImage.tsx`: Pretendard를 포함한 1200×630 PNG를 서버에서 생성합니다. 공개 가능한 패드는
  제목·설명·공개 방식·레이아웃·게시물 수와 보드 색상을 사용하고, 보호된 패드는 pyxis 로고와 기본
  문구만 그립니다. 사용자가 올린 첫 이미지는 공개 범위 변경이나 파일 권한과 엇갈릴 수 있어 자동
  썸네일로 사용하지 않습니다. `app/b/[slug]/share-image/[version]/route.ts`는 같은 버전의 PNG
  바이트를 Next 데이터 캐시에 한 시간 보관하고, 브라우저에는 5분·공유 CDN에는 1시간 캐시하도록
  응답합니다. 따라서 반복 요청은 DB 조회와 PNG 렌더링을 건너뛰면서, 이전 URL도 비공개 전환 뒤
  서버 캐시에 무기한 남지 않습니다.
