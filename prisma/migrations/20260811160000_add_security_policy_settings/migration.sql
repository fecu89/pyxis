ALTER TABLE "SystemSetting"
  ALTER COLUMN "adminReauthWindowMinutes" SET DEFAULT 60,
  ADD COLUMN "publicQuizJoinPerMinute" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "publicQuizApiRequestsPerMinute" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "publicQuizSocketEventsPerMinute" INTEGER NOT NULL DEFAULT 120,
  ADD COLUMN "publicQuizSocketMaxConnections" INTEGER NOT NULL DEFAULT 500,
  ADD COLUMN "publicQuizSocketConnectionsPerParticipant" INTEGER NOT NULL DEFAULT 3;
