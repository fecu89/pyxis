import "server-only";

import { Prisma } from "@/generated/prisma/client";

// 보기 여러 건의 텍스트·순서를 한 번의 SQL로 갱신합니다. lib/quiz/choice-bulk-update.ts와 같은
// 방식이고 이유도 같습니다.
//
// 왜 지우고 다시 만들지 않는가 — 보기 ID가 바뀌면 그 보기를 고른 과거 응답의
// `selectedOptionIds`가 아무것도 가리키지 않게 됩니다. 텍스트 스냅샷이 있어 "무엇을 골랐는지"는
// 남지만, "몇 명이 이 보기를 골랐나" 집계는 ID로 세므로 그 순간 전부 0이 됩니다.
//
// 왜 한 번에 묶는가 — 질문 20개 × 보기 5개짜리 설문을 저장하면 update가 100번 날아갑니다.
// 인터랙티브 트랜잭션의 5초 제한에 실제로 걸립니다(퀴즈에서 겪은 문제입니다).

export type FormOptionBulkUpdate = {
  id: string;
  text: string;
  position: number;
};

export async function bulkUpdateFormOptions(tx: Prisma.TransactionClient, options: FormOptionBulkUpdate[]) {
  if (!options.length) return 0;
  const values = options.map((option) => Prisma.sql`(
    ${option.id}::text, ${option.text}::text, ${option.position}::integer
  )`);
  return tx.$executeRaw(Prisma.sql`
    UPDATE "FormFieldOption" AS current
    SET "text" = incoming."text", "position" = incoming."position"
    FROM (VALUES ${Prisma.join(values)}) AS incoming("id", "text", "position")
    WHERE current."id" = incoming."id"`);
}
