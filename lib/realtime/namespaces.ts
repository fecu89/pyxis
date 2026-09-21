// Socket.IO namespace 이름. 서버(`server.ts`)와 클라이언트가 함께 쓰므로 React나 `server-only`에
// 의존하지 않습니다.
//
// 기본 namespace(`/`)는 의도적으로 비워 둡니다. `io.use()`는 기본 namespace에만 적용되기 때문에,
// 기본을 "퀴즈 인증 사용자"로 써 버리면 나중에 추가하는 namespace가 그 인증 미들웨어를 받지 못해
// 규칙이 조용히 어긋납니다. 모든 기능은 이름 있는 namespace를 씁니다.
export const QUIZ_NAMESPACE = "/quiz";
export const QUIZ_PUBLIC_NAMESPACE = "/quiz-public";
// 패드 실시간은 지금 SSE(`lib/realtime/board-events.ts`)가 담당합니다. 옮길 이유가 생기면
// 여기에 `/pad`를 추가합니다.

export const SOCKET_PATH = "/socket.io";
