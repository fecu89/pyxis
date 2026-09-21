import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApprovalPendingExperience } from "@/components/onboarding/approval-pending-experience";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeInternalCallbackUrl, redirectToLogin } from "@/lib/auth/page-guard";
import { getTeacherApprovalForUser } from "@/lib/users/teacher-approvals";
import { DASHBOARD_PATH } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "가입 승인 대기",
  description: "관리자가 가입 요청을 확인하고 있습니다.",
  robots: { index: false, follow: false },
};

export default async function ApprovalPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/approval-pending");
  const params = await searchParams;
  const candidateNextPath = safeInternalCallbackUrl(params.next, DASHBOARD_PATH);
  const nextPath = candidateNextPath.startsWith("/onboarding")
    || candidateNextPath.startsWith("/approval-pending")
    ? DASHBOARD_PATH
    : candidateNextPath;

  if (user.registrationApprovalStatus !== "APPROVED") {
    return (
      <ApprovalPendingExperience
        mode="ACCOUNT"
        name={user.name}
        loginIdentifier={user.loginIdentifier}
        image={user.image}
        requestedAtLabel={new Intl.DateTimeFormat("ko-KR", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Seoul",
        }).format(user.createdAt)}
        rejected={user.registrationApprovalStatus === "REJECTED"}
        reviewReason={user.registrationReviewReason}
        nextPath={nextPath}
      />
    );
  }

  if (user.onboardingCompletedAt) redirect(nextPath);
  const request = await getTeacherApprovalForUser(user.id);
  if (!request || request.status !== "PENDING") {
    redirect(`/onboarding?next=${encodeURIComponent(nextPath)}`);
  }

  return (
    <ApprovalPendingExperience
      mode="TEACHER"
      name={user.name}
      loginIdentifier={user.loginIdentifier}
      image={user.image}
      schoolName={request.school.name}
      departmentName={request.schoolGroup.name}
      requestedAtLabel={new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Seoul",
      }).format(new Date(request.requestedAt))}
      nextPath={nextPath}
    />
  );
}
