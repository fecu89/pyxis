ALTER TABLE "User" RENAME COLUMN "emailEncrypted" TO "loginIdentifierEncrypted";
ALTER TABLE "User" RENAME COLUMN "emailLookup" TO "loginIdentifierLookup";
ALTER INDEX "User_emailLookup_key" RENAME TO "User_loginIdentifierLookup_key";
