# 게시물 반응 검증 개요

이 폴더는 반응 키·정책·집계의 UI와 서버 공통 계약을 담당합니다.

- 기본 반응 키는 `LIKE`, `HEART`, `CELEBRATE`, `LAUGH`, `WOW` allowlist만 허용합니다.
- 사용자 이모지는 `EMOJI:` 접두사 뒤에 `Intl.Segmenter` 기준 정확히 한 grapheme만 허용합니다.
- 일반 문자 한 글자, 제어 문자, 공백, 여러 개의 이모지를 붙인 값은 거부합니다.
- 가족·직업·피부색처럼 ZWJ나 modifier로 조합된 하나의 이모지는 한 grapheme으로 보존합니다.
- 집계는 검증된 키와 0 이상의 안전한 정수만 허용하고 키 수를 제한합니다.

Route Handler는 이 검증 뒤 로그인·보드 접근·`allowReactions`·`SINGLE | MULTIPLE` 정책을 다시 검사해야 합니다. 클라이언트가 보낸 활성 상태나 집계 수를 신뢰하지 않고 DB 트랜잭션 결과로 응답합니다.
