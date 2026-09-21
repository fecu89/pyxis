# 링크 미리보기 개요

이 폴더는 게시물에 붙여 넣은 외부 URL에서 제목·설명·대표 이미지 같은 공개 메타데이터를 추출합니다.

- 서버 전용 네트워크 요청은 `fetch-preview.ts`에서 수행합니다.
- `http:`와 `https:`만 허용하고 URL 사용자 정보와 80·443 이외의 포트를 거부합니다.
- DNS 조회 결과에 사설망·루프백·링크 로컬·예약 주소가 하나라도 포함되면 요청하지 않습니다.
- 리다이렉트는 최대 3번만 따라가며 매 단계에서 URL과 DNS 주소를 다시 검증합니다.
- 외부 응답은 5초, HTML 3MB로 제한하고 압축되지 않은 `text/html`만 읽습니다. OG 메타가 있는
  `</head>`를 찾으면 즉시 스트림을 닫아 큰 본문을 다운로드하지 않습니다.
- YouTube의 watch·단축·Shorts·embed·live URL은 11자리 영상 ID만 추출한 뒤 고정된 YouTube oEmbed
  주소에서 최대 64KB JSON으로 제목과 썸네일을 받습니다. 응답의 iframe `html`은 사용하지 않습니다.
  동일한 URL 판별은 브라우저에서도 쓸 수 있는 `youtube-url.ts`에 모았고, 저장된 링크를 패드 카드와
  게시물 상세에서 다시 렌더링할 때도 고정된 `i.ytimg.com/vi/{id}/hqdefault.jpg`만 사용합니다.
- 일반 웹 링크의 검증된 대표 이미지는 링크 첨부를 확정할 때 `Attachment.previewImageUrl`에 함께
  저장합니다. 이후 화면을 열 때마다 외부 HTML을 다시 요청하지 않고 저장된 이미지 주소와
  `externalUrl`에서 계산한 호스트를 재사용합니다. `link-card.ts`가 YouTube와 일반 웹의 썸네일·
  `youtube.com` 같은 출처 라벨 계산을 공통으로 담당합니다.
- HTML은 실행하거나 DOM에 삽입하지 않고 Open Graph·Twitter 메타와 `<title>`의 텍스트만 추출합니다.
- 메타 URL에 따옴표·태그·제어문자를 섞은 속성 탈출 페이로드와 `javascript:`·`data:` URL은
  거부합니다. UI에서도 원격 값은 React 텍스트와 `<img src>` 문자열로만 전달하며 `innerHTML`을
  사용하지 않아 `onerror` 같은 문자열이 이벤트 핸들러가 될 수 없습니다.
- 대표 이미지와 canonical URL도 공개 HTTP(S) 주소인지 별도로 검증합니다.
- API는 로그인한 활성 사용자만 사용할 수 있고 사용자별 메모리 기반 호출 제한을 적용합니다.

이 기능은 미리보기 생성용이며 원격 파일 프록시나 다운로드 기능으로 사용하지 않습니다. 원격
이미지는 React의 고정된 `<img>` 속성으로만 표시하고 `referrerPolicy="no-referrer"`를 적용합니다.
