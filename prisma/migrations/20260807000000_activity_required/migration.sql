-- Board.activityId / QuizSession.activityId를 필수로 좁힙니다.
--
-- 활동 레코드를 붙였는지 사람이 기억하는 대신 컴파일러와 DB가 잡게 하려는 것입니다. 빠뜨리면
-- 그 활동은 /report에 아예 나타나지 않는데, 화면은 멀쩡히 뜨므로 눈으로는 발견되지 않습니다.
--
-- 순서가 중요합니다. NOT NULL을 걸기 전에 기존 행을 전부 백필해야 합니다.

-- 1) 활동이 없는 보드에 활동을 만들어 붙입니다.
--    학교·학급은 활동을 연 시점 값을 고정해야 하는데 과거 데이터에는 그 시점이 없으므로
--    소유자의 현재 소속을 씁니다. 새로 만들어지는 활동은 생성 시점 값을 그대로 갖습니다.
WITH new_activity AS (
  INSERT INTO "Activity" ("id", "type", "ownerId", "schoolId", "schoolGroupId", "title", "startedAt", "endedAt", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    'PAD_BOARD',
    b."ownerId",
    u."schoolId",
    u."schoolGroupId",
    b."title",
    NULL,
    NULL,
    b."createdAt",
    b."updatedAt"
  FROM "Board" b
  LEFT JOIN "User" u ON u."id" = b."ownerId"
  WHERE b."activityId" IS NULL
  RETURNING "id", "ownerId", "title", "createdAt"
)
UPDATE "Board" b
SET "activityId" = a."id"
FROM new_activity a
WHERE b."activityId" IS NULL
  AND b."createdAt" = a."createdAt"
  AND b."title" = a."title"
  AND b."ownerId" IS NOT DISTINCT FROM a."ownerId";

-- 2) 퀴즈 세션도 같은 방식으로.
WITH new_activity AS (
  INSERT INTO "Activity" ("id", "type", "ownerId", "schoolId", "schoolGroupId", "title", "startedAt", "endedAt", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    'QUIZ_SESSION',
    s."hostId",
    u."schoolId",
    u."schoolGroupId",
    q."title",
    s."startedAt",
    s."endedAt",
    s."createdAt",
    s."updatedAt"
  FROM "QuizSession" s
  JOIN "Quiz" q ON q."id" = s."quizId"
  LEFT JOIN "User" u ON u."id" = s."hostId"
  WHERE s."activityId" IS NULL
  RETURNING "id", "ownerId", "title", "createdAt"
)
UPDATE "QuizSession" s
SET "activityId" = a."id"
FROM new_activity a, "Quiz" q
WHERE s."activityId" IS NULL
  AND q."id" = s."quizId"
  AND s."createdAt" = a."createdAt"
  AND q."title" = a."title"
  AND s."hostId" IS NOT DISTINCT FROM a."ownerId";

-- 3) 백필이 하나라도 남았으면 여기서 멈춥니다. NOT NULL이 실패하는 것보다 이유가 분명합니다.
DO $$
DECLARE missing_boards INT; missing_sessions INT;
BEGIN
  SELECT COUNT(*) INTO missing_boards FROM "Board" WHERE "activityId" IS NULL;
  SELECT COUNT(*) INTO missing_sessions FROM "QuizSession" WHERE "activityId" IS NULL;
  IF missing_boards > 0 OR missing_sessions > 0 THEN
    RAISE EXCEPTION '활동 백필이 끝나지 않았습니다: 보드 %건, 세션 %건', missing_boards, missing_sessions;
  END IF;
END $$;

-- 4) 이제 NOT NULL을 걸고, FK를 SET NULL에서 CASCADE로 바꿉니다.
--    필수 컬럼에 SET NULL은 성립하지 않습니다. CASCADE는 "활동을 지우면 대상도 지운다"는
--    뜻이고, 반대 방향은 FK로 표현할 수 없어 영구 삭제 경로가 활동을 먼저 지웁니다.
ALTER TABLE "Board" ALTER COLUMN "activityId" SET NOT NULL;
ALTER TABLE "QuizSession" ALTER COLUMN "activityId" SET NOT NULL;

ALTER TABLE "Board" DROP CONSTRAINT "Board_activityId_fkey";
ALTER TABLE "Board" ADD CONSTRAINT "Board_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuizSession" DROP CONSTRAINT "QuizSession_activityId_fkey";
ALTER TABLE "QuizSession" ADD CONSTRAINT "QuizSession_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
