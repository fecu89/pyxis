# 짧은 주소 API 개요

`/api/short-links`는 패드·퀴즈 세션·설문의 `/go/{slug}` 별칭을 관리합니다.

- `GET ?targetType=...&targetId=...`: 기존 대상 관리 권한을 확인하고 현재 활성 별칭을 반환합니다. 사용자별 1분 120회 제한입니다.
- `PUT`: `{ targetType, targetId, slug }`로 별칭을 생성하거나 변경합니다. same-origin, 16KB JSON 상한, 사용자별 1분 30회 제한을 적용하고 트랜잭션에서 비활성 예약 행까지 명시적으로 충돌 검사합니다.
- `DELETE ?targetType=...&targetId=...`: 현재 별칭 연결만 비활성화합니다. slug 예약과 원주소·콘텐츠는 유지하며 same-origin과 같은 요청 제한을 적용합니다.
- 모든 응답은 대상·별칭 정보를 담으므로 `private, no-store`입니다.
- 권한과 형식의 정본은 `lib/short-links/overview.md`, 소비 UI는 `components/share/overview.md`입니다.
