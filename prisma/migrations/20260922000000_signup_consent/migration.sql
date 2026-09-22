ALTER TABLE "User"
  ADD COLUMN "registrationConsentAt" TIMESTAMP(3),
  ADD COLUMN "termsVersion" TEXT,
  ADD COLUMN "privacyVersion" TEXT,
  ADD COLUMN "age14Confirmed" BOOLEAN NOT NULL DEFAULT false;
