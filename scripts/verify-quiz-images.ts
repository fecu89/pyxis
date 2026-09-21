import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { getQuizImagePath, getQuizUploadDirectory, isQuizImageName } from "../lib/files/paths";
import { getPrisma } from "../lib/prisma";
import {
  assertQuizImageReferences,
  copyQuizImages,
  parseQuizImageUrl,
  pruneUnreferencedQuizImages,
  quizImageContentType,
  removeQuizImages,
  statQuizImage,
  storeQuizImage,
} from "../lib/quiz/image-store";
import { editorSaveSchema } from "../lib/quiz/question-schema";
import { sweepUnreferencedQuizImages } from "../lib/quiz/image-sweep";

// 퀴즈 이미지가 base64 data URL(DB)에서 파일(디스크)로 옮겨졌습니다. 이 스크립트는 그 경로를
// 실제 파일과 실제 행으로 한 번 통과시킵니다. tsc·lint로는 다음 셋 중 어느 것도 확인되지 않습니다.
//   - multipart 본문이 sharp를 거쳐 정말 WebP/JPEG로 떨어지는가
//   - 저장 때 훑는 정리가 "지금 쓰이는 파일"만 남기는가
//   - 복제가 원본 파일에서 독립하는가(원본을 지워도 사본이 살아남는가)

async function pngFixture(width: number, height: number) {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 1 } } })
    .png()
    .toBuffer();
}

function uploadRequest(bytes: Buffer, filename: string, type: string) {
  const body = new FormData();
  body.append("file", new Blob([new Uint8Array(bytes)], { type }), filename);
  return new Request("http://localhost/upload", { method: "POST", body });
}

async function main() {
  const prisma = getPrisma();
  const quizId = `verifyimg${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const cloneId = `verifyimg${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  try {
    // ── 1. 업로드: 큰 PNG를 넣으면 긴 변 1600 이하 WebP로 떨어져야 합니다.
    const big = await pngFixture(2400, 1200);
    const stored = await storeQuizImage(uploadRequest(big, "photo.png", "image/png"), quizId);
    const parsed = parseQuizImageUrl(stored.url);
    assert.ok(parsed, "저장된 주소를 다시 해석하지 못했습니다.");
    assert.equal(parsed.quizId, quizId, "주소의 퀴즈 ID가 다릅니다.");
    assert.ok(isQuizImageName(parsed.name), "파일 이름이 허용 형식이 아닙니다.");
    assert.ok(parsed.name.endsWith(".webp"), "문항 이미지는 webp여야 합니다.");
    assert.equal(stored.width, 1600, `긴 변이 1600으로 줄지 않았습니다(${stored.width}).`);
    assert.equal(quizImageContentType(parsed.name), "image/webp");

    const storedMeta = await sharp(getQuizImagePath(quizId, parsed.name)).metadata();
    assert.equal(storedMeta.format, "webp", `디스크의 실제 형식이 webp가 아닙니다(${storedMeta.format}).`);

    // ── 2. 썸네일: og:image 호환 때문에 jpeg여야 합니다(카카오톡이 webp를 못 그립니다).
    const thumbSource = await pngFixture(1200, 1200);
    const thumb = await storeQuizImage(uploadRequest(thumbSource, "cover.png", "image/png"), quizId, { thumbnail: true });
    const thumbParsed = parseQuizImageUrl(thumb.url)!;
    assert.ok(thumbParsed.name.endsWith(".jpg"), "썸네일은 jpg여야 합니다.");
    assert.equal(quizImageContentType(thumbParsed.name), "image/jpeg");
    assert.equal(thumb.width, 800, `썸네일 긴 변이 800으로 줄지 않았습니다(${thumb.width}).`);
    const thumbMeta = await sharp(getQuizImagePath(quizId, thumbParsed.name)).metadata();
    assert.equal(thumbMeta.format, "jpeg", `썸네일의 실제 형식이 jpeg가 아닙니다(${thumbMeta.format}).`);

    // ── 3. 이미지가 아닌 바이트는 거부돼야 합니다(확장자만 이미지인 파일).
    await assert.rejects(
      () => storeQuizImage(uploadRequest(Buffer.from("<script>alert(1)</script>"), "evil.png", "image/png"), quizId),
      "이미지가 아닌 파일이 통과했습니다.",
    );

    // ── 4. 경로 조작: 업로드 루트 밖을 가리키는 이름은 막혀야 합니다.
    assert.equal(parseQuizImageUrl(`/api/quiz/quizzes/${quizId}/images/../../../etc/passwd`), null);
    assert.throws(() => getQuizImagePath(quizId, "../../etc/passwd"), "상위 경로 이름이 통과했습니다.");
    assert.equal(await statQuizImage(quizId, "not-a-uuid.webp"), null);

    // ── 5. 저장 시 정리: 참조된 것만 남고 나머지는 지워져야 합니다.
    const orphan = await storeQuizImage(uploadRequest(await pngFixture(400, 400), "orphan.png", "image/png"), quizId);
    const orphanName = parseQuizImageUrl(orphan.url)!.name;
    // 다른 요청이 쓰는 중일 수 있는 임시 파일은 건드리면 안 됩니다.
    const uploading = path.join(getQuizUploadDirectory(quizId), `${randomUUID()}.webp.uploading`);
    await writeFile(uploading, "쓰는 중");

    // 갓 올린 파일은 유예 시간 안에 있으므로 지워지면 안 됩니다. 같은 퀴즈를 두 탭에서 열고
    // 한쪽이 저장했을 때, 다른 쪽이 방금 올린 사진이 사라지는 것을 막는 장치입니다.
    const spared = await pruneUnreferencedQuizImages(quizId, [stored.url, thumb.url]);
    assert.equal(spared, 0, "방금 올린 미참조 파일이 유예 없이 지워졌습니다.");
    assert.ok(await statQuizImage(quizId, orphanName), "유예 시간 안의 파일이 지워졌습니다.");

    // 유예가 지나면 지워져야 합니다(파일 시각 대신 기준 시각을 밀어 확인합니다).
    const removed = await pruneUnreferencedQuizImages(quizId, [stored.url, thumb.url], { now: Date.now() + 25 * 60 * 60_000 });
    assert.equal(removed, 1, `정리 대상이 1건이어야 하는데 ${removed}건이었습니다.`);
    assert.ok(await statQuizImage(quizId, parsed.name), "쓰이는 문항 이미지가 지워졌습니다.");
    assert.ok(await statQuizImage(quizId, thumbParsed.name), "쓰이는 썸네일이 지워졌습니다.");
    assert.equal(await statQuizImage(quizId, orphanName), null, "안 쓰이는 이미지가 남았습니다.");
    assert.ok(await stat(uploading).catch(() => null), "업로드 중인 임시 파일까지 지웠습니다.");
    await rm(uploading, { force: true });

    // 저장을 한 번도 하지 않고 떠난 업로드도 다음 저장 요청을 기다리지 않고 sweep가 회수합니다.
    const originalUploadDir = process.env.UPLOAD_DIR;
    const isolatedUploadDir = await mkdtemp(path.join(os.tmpdir(), "pyx-quiz-sweep-"));
    let purgeQuizId: string | null = null;
    try {
      process.env.UPLOAD_DIR = isolatedUploadDir;
      const abandonedQuizId = `verifyimg${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const abandoned = await storeQuizImage(
        uploadRequest(await pngFixture(320, 180), "abandoned.png", "image/png"),
        abandonedQuizId,
      );
      const owner = await prisma.user.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
      if (!owner) throw new Error("삭제 퀴즈 정리 검증에 사용할 활성 사용자가 없습니다.");
      const purgeQuiz = await prisma.quiz.create({
        data: {
          ownerId: owner.id,
          title: "삭제 퀴즈 이미지 정리 검증",
          deletedAt: new Date(Date.now() - 8 * 24 * 60 * 60_000),
        },
        select: { id: true },
      });
      purgeQuizId = purgeQuiz.id;
      await storeQuizImage(uploadRequest(await pngFixture(320, 180), "deleted.png", "image/png"), purgeQuiz.id);

      const swept = await sweepUnreferencedQuizImages({
        now: Date.now() + 25 * 60 * 60_000,
        deletedQuizPurgeDays: 7,
      });
      assert.equal(swept.removed, 1, "저장하지 않고 떠난 이미지를 sweep가 회수하지 못했습니다.");
      assert.equal(swept.purgedQuizzes, 1, "응시 이력 없는 오래된 삭제 퀴즈가 정리되지 않았습니다.");
      assert.equal(await prisma.quiz.findUnique({ where: { id: purgeQuiz.id } }), null, "삭제 퀴즈 DB 행이 남았습니다.");
      purgeQuizId = null;
      assert.equal(
        await statQuizImage(abandonedQuizId, parseQuizImageUrl(abandoned.url)!.name),
        null,
        "sweep 뒤에도 고아 이미지가 남았습니다.",
      );
    } finally {
      if (purgeQuizId) await prisma.quiz.delete({ where: { id: purgeQuizId } }).catch(() => undefined);
      if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = originalUploadDir;
      await rm(isolatedUploadDir, { recursive: true, force: true });
    }

    // ── 6. 복제: 파일이 복사되고 주소가 새로 매겨져야 합니다. 주소만 베끼면 원본을 지울 때
    //         사본의 사진까지 사라집니다.
    const mapping = await copyQuizImages(quizId, cloneId, [stored.url, thumb.url, "https://example.com/외부.png", null]);
    assert.equal(mapping.size, 2, "우리 파일 2건만 복사돼야 합니다(외부 주소·null은 제외).");
    const copiedUrl = mapping.get(stored.url)!;
    const copied = parseQuizImageUrl(copiedUrl)!;
    assert.equal(copied.quizId, cloneId, "사본 주소가 새 퀴즈를 가리키지 않습니다.");
    assert.notEqual(copied.name, parsed.name, "사본이 원본과 같은 파일 이름을 씁니다.");
    assert.deepEqual(
      await readFile(getQuizImagePath(cloneId, copied.name)),
      await readFile(getQuizImagePath(quizId, parsed.name)),
      "복사된 파일 내용이 원본과 다릅니다.",
    );
    const copiedThumbUrl = mapping.get(thumb.url)!;
    const copiedThumb = parseQuizImageUrl(copiedThumbUrl)!;
    assert.ok(copiedThumb.name.endsWith(".jpg"), "복제하면서 JPEG 썸네일 확장자가 바뀌었습니다.");
    assert.equal(quizImageContentType(copiedThumb.name), "image/jpeg");
    assert.equal(
      (await sharp(getQuizImagePath(cloneId, copiedThumb.name)).metadata()).format,
      "jpeg",
      "복제된 썸네일의 실제 형식이 JPEG가 아닙니다.",
    );
    await assertQuizImageReferences(cloneId, { thumbnailUrl: copiedThumbUrl, questionUrls: [copiedUrl] });
    await assert.rejects(
      () => assertQuizImageReferences(cloneId, { questionUrls: [stored.url] }),
      "다른 퀴즈의 내부 이미지 주소가 통과했습니다.",
    );

    // 원본 퀴즈의 이미지를 통째로 지워도 사본은 멀쩡해야 합니다.
    await removeQuizImages(quizId);
    assert.equal(await statQuizImage(quizId, parsed.name), null, "원본 정리가 되지 않았습니다.");
    assert.ok(await statQuizImage(cloneId, copied.name), "원본을 지우자 사본까지 사라졌습니다.");

    // ── 7. 저장 스키마가 새 주소 형식을 받아들여야 합니다. 여기서 막히면 사진을 올려도
    //         퀴즈가 저장되지 않습니다.
    const base = {
      title: "검증용",
      description: null,
      subjectName: null,
      thumbnailUrl: copiedThumbUrl,
      thumbnailAlt: null,
      requiresLogin: true,
      isSearchable: false,
      answerPalette: "BRAND" as const,
      questions: [{
        type: "SLIDE" as const,
        text: "제목",
        imageUrl: copiedUrl,
        imageAlt: null,
        imagePlaceholder: null,
        timeLimitSec: 30,
        points: 1000,
        multipleSelection: false,
        acceptedAnswers: [],
        orderedItems: [],
        numericMin: null,
        numericMax: null,
        numericAnswer: null,
        slideLayout: "TITLE_TEXT" as const,
        slideBody: "본문",
        likertSteps: null,
        likertMinLabel: null,
        likertMaxLabel: null,
        revealResponsesLive: false,
        pinAreas: null,
        choices: [],
      }],
    };
    assert.ok(editorSaveSchema.safeParse(base).success, "새 이미지 주소가 저장 스키마에서 거부됐습니다.");
    // 백필을 마친 뒤에는 새 data URL을 다시 DB에 넣지 못하게 막아야 합니다.
    const legacyPng = `data:image/png;base64,${(await pngFixture(8, 8)).toString("base64")}`;
    assert.equal(editorSaveSchema.safeParse({ ...base, thumbnailUrl: legacyPng }).success, false, "data URL이 다시 허용됐습니다.");
    assert.equal(editorSaveSchema.safeParse({ ...base, thumbnailUrl: "javascript:alert(1)" }).success, false, "위험한 주소가 통과했습니다.");

    console.log("quiz_image_checks=passed");
  } finally {
    await removeQuizImages(quizId);
    await removeQuizImages(cloneId);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
