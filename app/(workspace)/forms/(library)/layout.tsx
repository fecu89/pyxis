import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "설문", description: "설문지를 만들고 링크로 응답을 받습니다.", noIndex: true });

/** 상태별 설문 라우트가 공유하는 권한 경계입니다. 목록 프레임은 검색 상태와 함께 FormList가 그립니다. */
export default async function FormLibraryLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return <>{children}</>;
  if (user.role === "STUDENT") {
    return (
      <PageShell size="medium">
        <PageHeader eyebrow="FORMS" title="설문" description="이 화면은 선생님용입니다." />
        <EmptyState title="접근 권한이 없어요" description="받은 설문은 선생님이 보내 준 링크로 응답할 수 있습니다." />
      </PageShell>
    );
  }

  return <>{children}</>;
}
