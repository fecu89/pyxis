import type { NextConfig } from "next";
import { mb, UPLOAD_MULTIPART_HEADROOM_MB, UPLOAD_POLICY_BOUNDS } from "./lib/files/upload-policy-shape";

// Content-Security-Policy는 요청마다 새 nonce가 필요해 여기(정적 헤더)가 아니라 proxy.ts에서
// 만듭니다. 정적 헤더로 두면 인라인 스크립트를 'unsafe-inline'으로 통째로 허용할 수밖에 없어
// CSP의 XSS 방어 효과가 사실상 사라집니다. 아래 나머지 헤더는 요청과 무관한 고정값이라
// _next/static 같은 프록시 매처 밖 경로까지 함께 덮도록 계속 여기서 붙입니다.
const nextConfig: NextConfig = {
  // 개발 서버(.next)와 빌드 산출물이 같은 디렉터리를 쓰면, dev가 도는 중에 build를 돌렸을 때
  // 빌드가 매니페스트를 덮어써 실행 중인 서버의 모든 요청이 500이 됩니다. build/start의
  // 기본값은 .next-prod이고, yarn deploy는 .next-a/.next-b를 번갈아 빌드·실행합니다.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  allowedDevOrigins: ["p.pyx.kr", "localhost", "127.0.0.1"],
  experimental: {
    // proxy.ts가 모든 API 요청을 통과시키므로 Next의 기본 10MB 본문 복제 상한이 먼저 적용됩니다.
    // 실제 허용 크기는 DB의 Admin 설정을 매 요청마다 읽어 검증하지만, 이 값은 빌드 시 고정이라
    // 현재 DB 값(예: 30MB)에 맞추면 Admin이 값을 올린 직후 다시 막힙니다. 따라서 Admin 입력의
    // 최대 허용값 + multipart 여유를 인프라 상한으로 두고, 실제 파일 상한은 업로드 라우트가
    // 현재 Admin 값으로 강제합니다.
    proxyClientMaxBodySize: mb(UPLOAD_POLICY_BOUNDS.maxUploadMb.max + UPLOAD_MULTIPART_HEADROOM_MB),
  },
  // 패드 화면을 /pad/** 아래로 모으면서 바뀐 주소입니다. 상단 navbar가 URL 접두사로 섹션을
  // 판정하므로 한곳에 모여 있어야 합니다. 기존 북마크가 죽지 않게 리다이렉트를 둡니다.
  async redirects() {
    return [
      // 영구 — 사용자가 이미 밖으로 퍼뜨렸을 수 있는 주소입니다. 첨부 URL은 게시물 본문
      // 마크다운에 직접 붙여넣을 수 있고, 초대·복제 링크는 클립보드로 배포됩니다.
      { source: "/files/:attachmentId", destination: "/f/:attachmentId", permanent: true },
      { source: "/invite/:token", destination: "/i/:token", permanent: true },
      { source: "/copy/:slug", destination: "/b/:slug/copy", permanent: true },
      // 참여 주소도 QR·프로젝터로 배포됩니다. 공개/비공개가 한 라우트로 합쳐졌으므로
      // 옛 `/public/*` 짝도 같은 곳으로 보냅니다.
      { source: "/join", destination: "/j", permanent: true },
      { source: "/join/:pin", destination: "/j/:pin", permanent: true },
      { source: "/play/:sessionId", destination: "/p/:sessionId", permanent: true },
      { source: "/public/join/:pin", destination: "/j/:pin", permanent: true },
      { source: "/public/play/:sessionId", destination: "/p/:sessionId", permanent: true },
      { source: "/public/sessions/:sessionId/report", destination: "/p/:sessionId/report", permanent: true },
      // 임시 — 내부 링크뿐이라 되돌릴 여지를 남깁니다.
      // 생기부 문안은 상단 섹션(/recode)에서 리포트 사이드바의 한 줄로 내려왔습니다.
      { source: "/recode", destination: "/report/writeup", permanent: false },
      { source: "/favorites", destination: "/pad/favorites", permanent: false },
      { source: "/archived", destination: "/pad/archived", permanent: false },
      { source: "/folders/:folderId", destination: "/pad/folders/:folderId", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 게시물 작성기의 사진 촬영·음성 녹음(MediaCapture)이 카메라·마이크를 쓰므로
          // 이 두 개만 자기 출처에 허용하고 나머지(위치 등)는 기본적으로 막습니다.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
