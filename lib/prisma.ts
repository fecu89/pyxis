import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { pyxCoursePrisma?: PrismaClient };

function databasePoolMax() {
  const configured = Number(process.env.DATABASE_POOL_MAX ?? "10");
  return Number.isFinite(configured) ? Math.min(50, Math.max(1, Math.floor(configured))) : 10;
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.pyxCoursePrisma) return globalForPrisma.pyxCoursePrisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL 환경 변수가 설정되지 않았습니다.");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: databasePoolMax(),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    }),
  });
  globalForPrisma.pyxCoursePrisma = prisma;
  return prisma;
}
