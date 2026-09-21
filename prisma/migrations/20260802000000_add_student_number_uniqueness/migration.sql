-- Student numbers identify one student inside a class. PostgreSQL unique indexes
-- permit multiple NULL values, so legacy students can remain unnumbered while all
-- newly onboarded students are protected against duplicate class numbers.
CREATE UNIQUE INDEX "User_schoolGroupId_studentNumber_key"
ON "User"("schoolGroupId", "studentNumber");
