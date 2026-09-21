import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { EmptyState, InlineNotice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "생기부 작성", description: "활동 기록을 바탕으로 생활기록부 문안을 만듭니다.", noIndex: true });

// 활동 기록(/report)을 재료로 생활기록부 문안을 만드는 화면입니다. 아직 화면만 있고 생성
// 기능은 붙지 않았습니다 — 재료가 되는 Activity 계층이 먼저 자리잡아야 해서 순서를 이렇게 뒀습니다.
//
// 예전에는 /recode라는 별도 상단 섹션이었습니다. 재료가 전부 이 섹션의 Activity인데 navbar
// 한 칸을 차지하고 있어 리포트 사이드바로 내렸고, 상단 섹션 판정이 URL 접두사 기반이라
// 경로도 함께 /report 아래로 옮겼습니다(옛 주소는 next.config.ts가 리다이렉트).
export default async function ReportWriteupPage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/report/writeup");
  // 학생 개인정보를 다루므로 교사 이상만 봅니다. 매니페스트의 roles는 메뉴를 숨길 뿐이고
  // 실제 경계는 여기와 생성 API가 다시 검사합니다.
  if (user.role === "STUDENT") {
    return (
      <PageShell size="medium">
        <PageHeader eyebrow="리포트" title="생기부 작성" description="이 화면은 선생님용입니다." />
        <EmptyState title="접근 권한이 없어요" description="본인의 활동 기록은 리포트에서 볼 수 있습니다."
          action={<Link className="button primary" href="/report/students/me">내 응시 기록</Link>} />
      </PageShell>
    );
  }

  // 준비 중이라는 사실을 제목 옆까지 올립니다. 예전에는 본문 EmptyState에만 있어서, 메뉴에서
  // 눌러 들어와 헤더까지 읽은 뒤에야 아직 못 만든다는 걸 알 수 있었습니다.
  return (
    <PageShell>
      <PageHeader
        eyebrow="리포트 · 준비 중"
        title={<>생활기록부 문안 <span className="align-middle text-sm font-black text-warning-soft-fg">준비 중</span></>}
        description="퀴즈와 패드에서 쌓인 활동을 재료로 학생별 문안 초안을 만드는 화면입니다."
      />
      <div className="mb-6">
        <InlineNotice tone="warning">
          <b>문안 생성은 아직 붙지 않았습니다.</b> 지금은 화면만 있고 눌러서 문안을 만들 수 있는 곳이 없습니다.
          재료가 되는 활동 기록 계층이 먼저 자리잡아야 해서 순서를 이렇게 뒀습니다.
        </InlineNotice>
      </div>
      <EmptyState
        title="아직 준비 중이에요"
        description="먼저 리포트에서 학생별 활동이 충분히 쌓였는지 확인해 보세요."
        action={<Link className="button primary" href="/report">활동 리포트 보기</Link>}
      />
    </PageShell>
  );
}
