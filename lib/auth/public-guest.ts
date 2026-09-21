// 프록시가 승인 대기 계정의 공개 참여 요청을 게스트로 낮춰 전달할 때만 붙이는 내부 헤더입니다.
// 외부 요청이 같은 이름을 보내도 proxy.ts가 먼저 지우므로 권한 상승 신호로 사용할 수 없습니다.
export const PUBLIC_GUEST_REQUEST_HEADER = "x-pyxis-public-guest";
