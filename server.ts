// 반드시 첫 임포트여야 합니다 — 아래 임포트들이 env를 보고 모듈 평가 시점에 상수를 굳힙니다.
import "@/lib/load-env";
import { createServer } from "node:http";
import { parse as parseCookieHeader } from "cookie";
import next from "next";
import { getToken } from "next-auth/jwt";
import { Server as SocketIOServer } from "socket.io";
import { APP_NAME } from "@/lib/brand";
import { QUIZ_NAMESPACE, SOCKET_PATH } from "@/lib/realtime/namespaces";
import { registerPublicQuizSocketHandlers, registerQuizSocketHandlers, verifySocketUser } from "@/lib/realtime/socket-server";
import { startQuizImageSweeper } from "@/lib/quiz/image-sweep";
import { startFormResponseDigestScheduler } from "@/lib/forms/response-digest";
import { startFormFileSweeper } from "@/lib/forms/file-sweep";
import { startPadTrashSweeper } from "@/lib/files/pad-trash-sweep";
import { startPadImageWorker } from "@/lib/files/image-worker";

// Next.js 요청 처리와 Socket.IO를 한 http.Server에 얹습니다. 퀴즈의 실시간 진행(문항 시작·답안
// 제출·리더보드)이 SSE로는 부족한 양방향 통신이라 커스텀 서버가 필요합니다. 패드의 알림·보드
// 활동은 계속 SSE(`app/api/**/events`)를 쓰며, 이 서버 위에서도 그대로 동작합니다.
const port = Number(process.env.PORT ?? 3001);
const bindHost = process.env.BIND_HOST?.trim() || undefined;
const dev = process.env.NODE_ENV !== "production";

if (process.env.CLOUDFLARE_TUNNEL_ONLY === "true") {
  if (bindHost !== "127.0.0.1" && bindHost !== "::1" && bindHost !== "localhost") {
    throw new Error("CLOUDFLARE_TUNNEL_ONLY=true이면 BIND_HOST를 loopback 주소로 설정해야 합니다.");
  }
  if (process.env.TRUST_CLOUDFLARE_IP_HEADER !== "true") {
    throw new Error("Cloudflare Tunnel 전용 배포에서는 TRUST_CLOUDFLARE_IP_HEADER=true가 필요합니다.");
  }
}
// 이 프로젝트의 커스텀 서버에서 Turbopack이 라우트 전환 중 간헐적으로 설치된 next 패키지를
// 찾지 못했다고 판단하며 전체 dev 프로세스를 panic시키는 문제가 있었습니다. Next 16은 커스텀
// 서버에 bundler를 명시할 수 있으므로 개발만 webpack으로 고정합니다. 프로덕션 실행에는 번들러
// 선택을 넘기지 않아 NEXT_DIST_DIR에 지정된 운영 산출물을 그대로 읽습니다.
const app = next({ dev, ...(dev ? { webpack: true } : {}) });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Next 핸들러를 먼저 등록해야 합니다. engine.io의 attach()가 이 시점의 'request' 리스너를
  // 캐시해 두고 /socket.io 이외의 요청을 그쪽으로 되돌려 주기 때문입니다.
  const httpServer = createServer((req, res) => handle(req, res));

  const io = new SocketIOServer(httpServer, {
    path: SOCKET_PATH,
    // 클라이언트는 번들에 포함되므로 /socket.io/socket.io.js 정적 제공은 끕니다.
    serveClient: false,
    // engine.io는 자기 경로가 아닌 upgrade 요청을 1초 뒤 (아직 아무것도 안 쓰였으면) 끊습니다.
    // Next 개발 서버의 HMR 소켓(/_next/webpack-hmr)이 그 안에 101을 못 쓰면 Fast Refresh가
    // 조용히 죽으므로 끕니다. Next의 upgrade 핸들러는 getRequestHandler()가 첫 요청 때 자동
    // 등록하므로 여기서 직접 배선하면 리스너가 두 개가 됩니다 — 하지 마세요.
    destroyUpgrade: false,
    // WebSocket 핸드셰이크에는 브라우저의 동일 출처 정책이 적용되지 않습니다(쿠키의
    // SameSite=Lax가 유일한 방어). Origin을 직접 확인합니다. 네이티브 클라이언트처럼 Origin이
    // 없는 요청은 통과시킵니다.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) return callback(null, true);
      const host = req.headers["x-forwarded-host"]?.toString().split(",")[0]?.trim() || req.headers.host;
      try {
        callback(null, new URL(origin).host === host);
      } catch {
        callback(null, false);
      }
    },
  });

  // 인증 미들웨어는 이름 있는 namespace에만 겁니다. io.use()는 기본 namespace(/)에만 적용되어,
  // 기본을 쓰면 나중에 추가하는 namespace가 이 검사를 받지 못합니다.
  io.of(QUIZ_NAMESPACE).use(async (socket, done) => {
    try {
      // socket.request는 순수 http.IncomingMessage라서 next-auth의 getToken()이 기대하는
      // req.cookies(파싱된 객체)가 없습니다 — 원시 Cookie 헤더를 직접 파싱해 채워 줍니다.
      const cookies = parseCookieHeader(socket.request.headers.cookie ?? "");
      const token = await getToken({
        req: { headers: socket.request.headers, cookies } as Parameters<typeof getToken>[0]["req"],
        secret: process.env.AUTH_SECRET,
      });
      if (!token?.userId || token.sessionInvalid) return done(new Error("UNAUTHORIZED"));
      // 서명 검증만으로는 정지·거절·비밀번호 재설정이 반영되지 않으므로 DB로 다시 확인합니다.
      const user = await verifySocketUser(
        token.userId as string,
        typeof token.authVersion === "number" ? token.authVersion : null,
      );
      if (!user) return done(new Error("UNAUTHORIZED"));
      socket.data.userId = user.id;
      socket.data.role = user.role;
      socket.data.systemPermissions = user.systemPermissions;
      done();
    } catch {
      done(new Error("UNAUTHORIZED"));
    }
  });

  registerQuizSocketHandlers(io);
  registerPublicQuizSocketHandlers(io);

  httpServer.listen(port, bindHost, () => {
    startQuizImageSweeper();
    startFormResponseDigestScheduler();
    startFormFileSweeper();
    startPadTrashSweeper();
    const imageWorker = startPadImageWorker();
    const stopImages = () => { void imageWorker.stop().finally(() => process.exit(0)); };
    process.once("SIGTERM", stopImages);
    process.once("SIGINT", stopImages);
    console.log(`> ${APP_NAME} ready on ${bindHost ?? "0.0.0.0"}:${port} (${dev ? "dev" : "production"})`);
  });
});
