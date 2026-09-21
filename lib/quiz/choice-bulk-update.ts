import "server-only";

import { Prisma } from "@/generated/prisma/client";

export type ChoiceBulkUpdate = {
  id: string;
  text: string;
  isCorrect: boolean;
  position: number;
};

/** 서로 다른 보기 값을 PostgreSQL VALUES 한 번으로 갱신합니다. 기존 ID와 답안 FK는 유지됩니다. */
export async function bulkUpdateChoices(tx: Prisma.TransactionClient, choices: ChoiceBulkUpdate[]) {
  if (!choices.length) return 0;
  const values = choices.map((choice) => Prisma.sql`(
    ${choice.id}::text,
    ${choice.text}::text,
    ${choice.isCorrect}::boolean,
    ${choice.position}::integer
  )`);
  return tx.$executeRaw(Prisma.sql`
    UPDATE "Choice" AS current
    SET
      "text" = incoming."text",
      "isCorrect" = incoming."isCorrect",
      "position" = incoming."position"
    FROM (VALUES ${Prisma.join(values)}) AS incoming("id", "text", "isCorrect", "position")
    WHERE current."id" = incoming."id"
  `);
}
