import type { ReactNode } from "react";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "리포트", description: "퀴즈·패드·설문에서 일어난 활동을 한 흐름으로 봅니다.", noIndex: true });

/** 활동 종류별 라우트가 공유하는 헤더와 탭. 종류를 바꿔도 이 프레임은 다시 마운트되지 않습니다. */
export default async function ActivityReportLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return <>{children}</>;
  return (
    <PageShell>
      <PageHeader
        eyebrow="REPORT"
        title="활동 리포트"
        description="퀴즈 세션, 패드, 설문을 한 흐름으로 봅니다. 항목을 열면 참여자별 상세로 이어집니다."
      />
      {children}
    </PageShell>
  );
}
