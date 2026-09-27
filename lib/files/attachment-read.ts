import { open } from "node:fs/promises";
import { getPrisma } from "@/lib/prisma";
import { resolveStoredFile } from "@/lib/files/paths";

/** Caller already authorized the attachment. Reopening only follows this same live attachment ID. */
export async function openAttachmentRepresentation<T extends { id: string; storagePath: string | null }>(snapshot: T) {
  let attachment = snapshot;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!attachment.storagePath) throw new Error("첨부 파일 저장 정보가 없습니다.");
    try {
      const handle = await open(/* turbopackIgnore: true */ resolveStoredFile(attachment.storagePath), "r");
      return { attachment, handle };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || attempt !== 0) throw error;
      const current = await getPrisma().attachment.findFirst({ where: {
        id: snapshot.id, deletedAt: null, post: { deletedAt: null, board: { deletedAt: null } },
      } });
      if (!current?.storagePath) throw error;
      attachment = { ...snapshot, ...current };
    }
  }
  throw new Error("첨부 파일을 읽지 못했습니다.");
}
