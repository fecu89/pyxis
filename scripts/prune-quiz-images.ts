import "../lib/load-env";
import { getPrisma } from "../lib/prisma";
import { sweepUnreferencedQuizImages } from "../lib/quiz/image-sweep";

async function main() {
  const result = await sweepUnreferencedQuizImages();
  console.log(`quiz_image_sweep=done scanned=${result.scanned} removed=${result.removed} purged_quizzes=${result.purgedQuizzes}`);
  await getPrisma().$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect().catch(() => undefined);
  process.exit(1);
});
