import { rm, unlink } from "node:fs/promises";
import { getBoardUploadDirectory, resolveStoredFile } from "@/lib/files/paths";

export type StoredAttachmentFiles = {
  storagePath: string | null;
  thumbnailPath: string | null;
};

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
}

export async function removeStoredAttachmentFiles(attachments: StoredAttachmentFiles[]) {
  const paths = new Set<string>();
  attachments.forEach((attachment) => {
    if (attachment.storagePath) {
      paths.add(attachment.storagePath);
      // 문서 미리보기는 원본의 파생 파일입니다. 개별 첨부 purge에서도 같이 지워야 고아 캐시가
      // 남지 않습니다. 없는 경우는 아래 ENOENT 처리로 자연스럽게 넘어갑니다.
      paths.add(`${attachment.storagePath}.preview.pdf`);
    }
    if (attachment.thumbnailPath) paths.add(attachment.thumbnailPath);
  });

  let removed = 0;
  let missing = 0;
  const failures: Array<{ path: string; error: unknown }> = [];
  const pendingPaths = Array.from(paths);
  let nextIndex = 0;

  async function removeNext() {
    while (nextIndex < pendingPaths.length) {
      const storagePath = pendingPaths[nextIndex++];
      try {
        await unlink(/* turbopackIgnore: true */ resolveStoredFile(storagePath));
        removed += 1;
      } catch (error) {
        if (errorCode(error) === "ENOENT") missing += 1;
        else failures.push({ path: storagePath, error });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, pendingPaths.length) }, () => removeNext()));

  if (failures.length) console.error("첨부 파일 정리에 실패했습니다.", failures);
  return { removed, missing, failed: failures.length };
}

export async function removeBoardUploadDirectory(boardId: string) {
  try {
    await rm(/* turbopackIgnore: true */ getBoardUploadDirectory(boardId), { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error("패드 업로드 디렉터리 정리에 실패했습니다.", { boardId, error });
    return false;
  }
}
