import { randomInt } from "node:crypto";
import { getPrisma } from "@/lib/prisma";

// 학생이 참여할 때 입력하는 6자리 세션 PIN 코드입니다.
// 이미지 위에 꽂는 "핀"(lib/quiz/image-pin.ts)과는 전혀 다른 것이라 이름을 갈라 두었습니다.

export async function generateUniquePin(): Promise<string> {
  const prisma = getPrisma();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pin = String(randomInt(100000, 1000000));
    const existing = await prisma.quizSession.findUnique({ where: { pinCode: pin }, select: { id: true } });
    if (!existing) return pin;
  }
  throw new Error("PIN 코드를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
