-- 패드 설정에서 바뀐 제목이 과거 대시보드·리포트용 Activity 복제본에도 일치하도록 보정합니다.
UPDATE "Activity" AS activity
SET "title" = board."title",
    "updatedAt" = CURRENT_TIMESTAMP
FROM "Board" AS board
WHERE board."activityId" = activity."id"
  AND activity."title" IS DISTINCT FROM board."title";
