import { RegistrationApprovalQueue } from "@/components/admin/registration-approval-queue";
import { TeacherApprovalQueue } from "@/components/admin/teacher-approval-queue";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getTeacherApprovalQueue } from "@/lib/users/teacher-approvals";
import { getRegistrationApprovalQueue } from "@/lib/users/registration-approvals";

export default async function AdminApprovalsPage() {
  const context = await getAdminSectionContext("approvals");
  if (!context) return null;
  const [teacherResult, accountResult] = await Promise.all([
    getTeacherApprovalQueue({ schoolId: context.scopedSchoolId ?? undefined, page: 1, pageSize: 20 }),
    context.user.role === "SUPER_ADMIN"
      ? getRegistrationApprovalQueue({ page: 1, pageSize: 20 })
      : null,
  ]);
  return (
    <div className="grid gap-5">
      {accountResult && <RegistrationApprovalQueue initialRequests={accountResult.requests} initialTotalCount={accountResult.totalCount} initialPage={accountResult.page} initialPageSize={accountResult.pageSize} />}
      <TeacherApprovalQueue initialRequests={teacherResult.requests} initialTotalCount={teacherResult.totalCount} initialPage={teacherResult.page} initialPageSize={teacherResult.pageSize} />
    </div>
  );
}
