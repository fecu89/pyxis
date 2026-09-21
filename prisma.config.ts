import "./lib/load-env";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // 모델 수가 많아 한 파일에 두기 어려우므로 Prisma 7 멀티파일 스키마를 사용해
  // 도메인별(identity/activity/quiz/pad)로 나눠 둡니다.
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
