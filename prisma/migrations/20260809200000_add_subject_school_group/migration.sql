-- 교과목에 학급(SchoolGroup)을 통째로 연결합니다. 기존 SubjectStudent(개별 배정)는 그대로 두고,
-- 교과목의 실제 명단을 "개별 배정 ∪ 연결된 학급의 활성 학생"으로 계산하기 위한 두 번째 축입니다.
--
-- 400명 규모에서 반 하나를 넣으려고 체크박스를 28번 누르는 건 쓸 수 없고, 반대로 "이 반에서
-- 3명만 빼고" 같은 예외도 실제로 생기기 때문에 둘 다 필요합니다.
CREATE TABLE "SubjectSchoolGroup" (
    "subjectId" TEXT NOT NULL,
    "schoolGroupId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectSchoolGroup_pkey" PRIMARY KEY ("subjectId","schoolGroupId")
);

-- 학급 → 교과목 역방향 조회와 명단 합집합 계산에 씁니다.
CREATE INDEX "SubjectSchoolGroup_schoolGroupId_idx" ON "SubjectSchoolGroup"("schoolGroupId");
CREATE INDEX "SubjectSchoolGroup_assignedById_idx" ON "SubjectSchoolGroup"("assignedById");

-- 교과목·학급이 사라지면 연결도 함께 사라집니다. 배정한 교사 계정은 감사 목적이라
-- 연결이 남아 있는 동안 삭제를 막습니다(SubjectStudent.assignedById와 같은 정책).
ALTER TABLE "SubjectSchoolGroup" ADD CONSTRAINT "SubjectSchoolGroup_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectSchoolGroup" ADD CONSTRAINT "SubjectSchoolGroup_schoolGroupId_fkey"
    FOREIGN KEY ("schoolGroupId") REFERENCES "SchoolGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubjectSchoolGroup" ADD CONSTRAINT "SubjectSchoolGroup_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
