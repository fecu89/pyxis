import { getCurrentUser } from "@/lib/auth/current-user";
import { ProfileForm } from "@/components/home/profile-form";
import { redirectToLogin } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

// 프로필은 예전에 모달이었지만("왜 굳이 창을 띄우냐"는 피드백) 지금은 다른 화면들과 같은
// 라우트 페이지입니다. 대시보드 셸(사이드바·상단바)은 app/(dashboard)/layout.tsx가 그립니다.
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/profile");
  return (
    <ProfileForm
      initialName={user.name}
      initialImage={user.image}
      loginIdentifier={user.loginIdentifier}
      loginType={user.loginType}
      role={user.role}
      school={user.school}
      schoolGroup={user.schoolGroup}
      hasPasswordCredential={user.hasPasswordCredential}
      studentNumber={user.studentNumber}
    />
  );
}
