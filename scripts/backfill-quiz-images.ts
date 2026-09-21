import "../lib/load-env";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { getQuizImagePath, getQuizUploadDirectory } from "../lib/files/paths";
import { getPrisma } from "../lib/prisma";
import { quizImageUrl } from "../lib/quiz/image-store";

// 퀴즈 이미지를 base64 data URL(DB 컬럼)에서 파일로 옮깁니다.
//
// 옮기고 나면 Question.imageUrl / Quiz.thumbnailUrl에는 주소만 남습니다. 값을 소비하는 화면은
// 문자열을 <img src>에 그대로 넣을 뿐이라 손댈 것이 없습니다.
//
// 여러 번 돌려도 안전합니다 — data: 로 시작하는 값만 골라 처리하며, DB 값이 변하지 않았을
// 때만 조건부 갱신합니다. 파일은 임시 이름으로 완성한 뒤 rename하고, DB 갱신이 충돌하면 지웁니다.
// 프로세스가 rename 직후 강제 종료돼 남은 파일은 주기적인 quiz image sweep가 회수합니다.

const DATA_URL = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i;
const MAX_QUIZ_IMAGE_EDGE = 1600;
const MAX_QUIZ_THUMBNAIL_EDGE = 800;

const dryRun = process.argv.includes("--dry-run");

type Converted = { url: string; bytes: number; filePath: string | null };

async function convert(quizId: string, dataUrl: string, thumbnail: boolean): Promise<Converted | null> {
  const matched = DATA_URL.exec(dataUrl);
  if (!matched) return null;
  const source = Buffer.from(matched[2], "base64");

  // 썸네일만 jpeg입니다(og:image 호환). 업로드 라우트와 같은 규칙을 씁니다.
  const name = `${randomUUID()}.${thumbnail ? "jpg" : "webp"}`;
  const edge = thumbnail ? MAX_QUIZ_THUMBNAIL_EDGE : MAX_QUIZ_IMAGE_EDGE;
  const pipeline = sharp(source, { failOn: "error", limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
  const output = thumbnail
    ? await pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    : await pipeline.webp({ quality: 82, effort: 4 }).toBuffer();

  const filePath = getQuizImagePath(quizId, name);
  if (!dryRun) {
    const temporaryPath = `${filePath}.uploading`;
    await mkdir(getQuizUploadDirectory(quizId), { recursive: true });
    try {
      await writeFile(temporaryPath, output, { flag: "wx" });
      await rename(temporaryPath, filePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
  return { url: quizImageUrl(quizId, name), bytes: output.byteLength, filePath: dryRun ? null : filePath };
}

async function removeConvertedFile(result: Converted) {
  if (result.filePath) await unlink(result.filePath).catch(() => undefined);
}

async function main() {
  const prisma = getPrisma();
  let movedBytes = 0;
  let freedBytes = 0;
  let converted = 0;
  let failed = 0;

  console.log(`퀴즈 이미지 백필을 시작합니다${dryRun ? " (--dry-run: 파일을 쓰지 않습니다)" : ""}.`);

  let questionCursor: string | undefined;
  while (true) {
    const questions = await prisma.question.findMany({
      where: {
        imageUrl: { startsWith: "data:" },
        ...(questionCursor ? { id: { gt: questionCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 50,
      select: { id: true, quizId: true, imageUrl: true },
    });
    if (!questions.length) break;
    questionCursor = questions.at(-1)!.id;

    for (const question of questions) {
      let result: Converted | null = null;
      try {
        result = await convert(question.quizId, question.imageUrl!, false);
        if (!result) throw new Error("data URL 형식을 알아보지 못했습니다.");
        if (!dryRun) {
          const updated = await prisma.question.updateMany({
            where: { id: question.id, imageUrl: question.imageUrl },
            data: { imageUrl: result.url },
          });
          if (updated.count !== 1) {
            await removeConvertedFile(result);
            continue;
          }
        }
        freedBytes += question.imageUrl!.length;
        movedBytes += result.bytes;
        converted += 1;
      } catch (error) {
        if (result) await removeConvertedFile(result);
        failed += 1;
        console.warn(`  [실패] question:${question.id} 사유=${error instanceof Error ? error.message : "알 수 없음"}`);
      }
    }
  }

  let quizCursor: string | undefined;
  while (true) {
    const quizzes = await prisma.quiz.findMany({
      where: {
        thumbnailUrl: { startsWith: "data:" },
        ...(quizCursor ? { id: { gt: quizCursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 50,
      select: { id: true, thumbnailUrl: true },
    });
    if (!quizzes.length) break;
    quizCursor = quizzes.at(-1)!.id;

    for (const quiz of quizzes) {
      let result: Converted | null = null;
      try {
        result = await convert(quiz.id, quiz.thumbnailUrl!, true);
        if (!result) throw new Error("data URL 형식을 알아보지 못했습니다.");
        if (!dryRun) {
          const updated = await prisma.quiz.updateMany({
            where: { id: quiz.id, thumbnailUrl: quiz.thumbnailUrl },
            data: { thumbnailUrl: result.url },
          });
          if (updated.count !== 1) {
            await removeConvertedFile(result);
            continue;
          }
        }
        freedBytes += quiz.thumbnailUrl!.length;
        movedBytes += result.bytes;
        converted += 1;
      } catch (error) {
        if (result) await removeConvertedFile(result);
        failed += 1;
        console.warn(`  [실패] quiz:${quiz.id} 사유=${error instanceof Error ? error.message : "알 수 없음"}`);
      }
    }
  }

  console.log(
    `quiz_image_backfill=${failed ? "partial" : "done"} 옮김=${converted}건 실패=${failed}건`
    + ` DB에서_줄어듦=${(freedBytes / 1048576).toFixed(2)}MB 디스크에_쓰임=${(movedBytes / 1048576).toFixed(2)}MB`,
  );
  if (failed) process.exitCode = 1;
  await prisma.$disconnect();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
