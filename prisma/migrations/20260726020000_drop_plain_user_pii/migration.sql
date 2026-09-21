ALTER TABLE "User"
  ALTER COLUMN "emailEncrypted" SET NOT NULL,
  ALTER COLUMN "emailLookup" SET NOT NULL;

DROP INDEX IF EXISTS "User_email_key";

ALTER TABLE "User"
  DROP COLUMN "email",
  DROP COLUMN "name",
  DROP COLUMN "image";
