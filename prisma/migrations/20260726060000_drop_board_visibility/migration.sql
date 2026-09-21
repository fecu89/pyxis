-- DropIndex
DROP INDEX "Board_visibility_idx";

-- AlterTable
ALTER TABLE "Board" DROP COLUMN "visibility";

-- DropEnum
DROP TYPE "BoardVisibility";

