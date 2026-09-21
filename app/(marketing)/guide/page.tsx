import Link from "next/link";
import { BookOpenCheck, LayoutDashboard, MessageCircleMore, PencilLine, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DASHBOARD_PATH, PUBLIC_HOME_PATH } from "@/lib/routes";
import { APP_NAME } from "@/lib/brand";
import { getMetadata } from "@/utils/seo/getMetadata";

export const metadata = getMetadata({
  title: "활용법",
  description: `${APP_NAME}의 패드와 퀴즈를 수업에서 어떻게 쓰는지 단계별로 안내합니다.`,
  asPath: "/guide",
  keywords: ["수업 활용법", "학급 게시판 사용법", "퀴즈 수업"],
});

const steps = [
  {
    icon: LayoutDashboard,
    title: "패드를 만들어 수업을 연다",
    body: "패드는 학생의 글·이미지·영상이 카드로 모이는 판입니다. 자유 배치·구역·목록 중 수업 방식에 맞는 배치를 고르고, 공개 범위와 글쓰기 권한을 정합니다.",
  },
  {
    icon: PencilLine,
    title: "학생이 링크로 바로 참여한다",
    body: "패드 주소만 알려 주면 됩니다. 로그인 없이 열 수 있게 설정하면 계정을 만들지 않아도 글을 남길 수 있고, 학생 계정으로 받으면 활동이 개인 기록에 쌓입니다.",
  },
  {
    icon: MessageCircleMore,
    title: "댓글과 반응으로 되돌려 준다",
    body: "카드마다 댓글과 반응을 달 수 있습니다. 새 글·댓글·멘션은 알림으로 실시간 전달되므로 수업 중에도 흐름을 놓치지 않습니다.",
  },
  {
    icon: BookOpenCheck,
    title: "퀴즈로 이해도를 확인한다",
    body: "문항을 만들고 발행하면 실시간(LIVE)과 자율 풀이(ASYNC) 두 방식으로 낼 수 있습니다. 실시간은 PIN이나 QR로 참여하고, 자율 풀이는 학생별로 할당합니다.",
  },
  {
    icon: Users,
    title: "리포트에서 한 흐름으로 본다",
    body: "퀴즈와 패드 활동이 리포트의 한 타임라인에 모입니다. 학생별로 열면 그 학생이 어느 수업에서 무엇을 했는지 양쪽 기록이 함께 보입니다.",
  },
  {
    icon: ShieldCheck,
    title: "학교 단위로 관리한다",
    body: "학교·학년·반과 회원 권한을 관리 콘솔에서 다룹니다. 교사 가입은 학교 관리자 승인 뒤 완료되고, 모든 관리 작업은 감사 로그에 남습니다.",
  },
] as const;

export default function GuidePage() {
  return (
    <main className="guide-page">
      <header className="guide-header">
        <Link href={PUBLIC_HOME_PATH} className="guide-brand" aria-label={`${APP_NAME} 홈`}>
          <Logo size={30} />
          <span>{APP_NAME}</span>
        </Link>
        <div className="guide-header-actions">
          <ThemeToggle />
          <Link href={DASHBOARD_PATH} className="button primary">시작하기</Link>
        </div>
      </header>

      <section className="guide-intro">
        <h1>수업에서 이렇게 씁니다</h1>
        <p>패드로 생각을 모으고, 퀴즈로 확인하고, 리포트에서 한 흐름으로 봅니다. 여섯 단계면 충분합니다.</p>
      </section>

      <ol className="guide-steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="guide-step-index" aria-hidden>{index + 1}</span>
            <div className="guide-step-icon" aria-hidden><step.icon size={20} /></div>
            <div>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="guide-cta">
        <h2>바로 만들어 볼까요?</h2>
        <p>계정을 만들면 첫 패드까지 1분이면 충분합니다.</p>
        <Link href={DASHBOARD_PATH} className="button primary">{APP_NAME} 시작하기</Link>
      </section>
    </main>
  );
}
