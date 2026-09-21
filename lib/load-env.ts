import { loadEnvConfig } from "@next/env";

// `server.ts`(tsx)는 Next가 `.env*`를 로드하기(`app.prepare()`) 전에 다른 모듈을 평가합니다.
// 그 시점에 `NEXTAUTH_URL`이 비어 있으면 소켓 인증이 일반 쿠키 이름(`next-auth.session-token`)을
// 찾는데 Next 쪽 로그인은 `__Secure-next-auth.session-token`을 쓰는 이름 분열이 생겨,
// 프로덕션에서 웹은 멀쩡한데 소켓만 UNAUTHORIZED로 떨어집니다.
//
// 가장 먼저 임포트되는 이 모듈이 Next와 같은 규칙으로 env를 미리 로드해 두 세계가 같은 값을
// 보게 합니다. `server.ts`의 **첫 임포트**여야 의미가 있습니다.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
