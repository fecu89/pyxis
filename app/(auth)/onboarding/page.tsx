import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeInternalCallbackUrl, redirectToLogin } from "@/lib/auth/page-guard";
import { getOnboardingOrganizationOptions } from "@/lib/users/organization";
import { getTeacherApprovalForUser } from "@/lib/users/teacher-approvals";
import { OnboardingExperience } from "@/components/onboarding/onboarding-experience";
import { DASHBOARD_PATH } from "@/lib/routes";
import { APP_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "가입 정보 설정",
  description: `${APP_NAME}에서 사용할 프로필과 학교 소속을 설정합니다.`,
  robots: { index: false, follow: false },
};

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/onboarding");
  if (user.onboardingCompletedAt) redirect(DASHBOARD_PATH);
  const [schools, params, teacherRequest] = await Promise.all([
    getOnboardingOrganizationOptions(),
    searchParams,
    getTeacherApprovalForUser(user.id),
  ]);
  const candidateNextPath = safeInternalCallbackUrl(params.next, DASHBOARD_PATH);
  const nextPath = candidateNextPath.startsWith("/onboarding")
    || candidateNextPath.startsWith("/approval-pending")
    ? DASHBOARD_PATH
    : candidateNextPath;

  return (
    <OnboardingExperience
      initialName={user.name}
      initialImage={user.image}
      loginIdentifier={user.loginIdentifier}
      loginType={user.loginType}
      role={user.role}
      initialAccountType={teacherRequest || user.role === "TEACHER" ? "TEACHER" : "STUDENT"}
      initialSchoolId={teacherRequest?.school.id ?? user.school?.id ?? null}
      initialSchoolGroupId={teacherRequest?.schoolGroup.id ?? user.schoolGroup?.id ?? null}
      initialStudentNumber={user.studentNumber}
      rejectionReason={teacherRequest?.status === "REJECTED" ? teacherRequest.reviewReason : null}
      schools={schools}
      nextPath={nextPath}
    />
  );
}
