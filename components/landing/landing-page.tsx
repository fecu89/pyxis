import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ClipboardList,
  Eye,
  Gamepad2,
  LayoutDashboard,
  LockKeyhole,
  MessageCircleMore,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
  Wand2,
} from "lucide-react";
import { HomeAuthActionsProvider, LoginButton } from "@/components/home/home-actions";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DASHBOARD_PATH } from "@/lib/routes";
import { APP_NAME } from "@/lib/brand";
import styles from "./landing.module.css";

type LandingPageProps = {
  authError: string | null;
  initialLoginOpen: boolean;
  loginCallbackUrl: string;
};

// 패드·퀴즈·설문 세 활동이 쌓여 생기부 초안으로 이어진다는 흐름 순서 그대로 카드를 둡니다.
// 마지막 카드(AI 생기부)가 이 페이지의 차별점이라 sun(가장 밝은 톤)을 맡깁니다.
const featureItems = [
  {
    icon: PencilLine,
    title: "패드로 생각 기록",
    description: "글, 이미지, 영상과 링크를 카드에 담아 수업 흐름대로 정리해요.",
    tone: "mint",
  },
  {
    icon: Gamepad2,
    title: "퀴즈로 이해도 확인",
    description: "실시간 퀴즈와 자율 풀이로 문제를 내면, 응답이 자동으로 기록에 쌓여요.",
    tone: "violet",
  },
  {
    icon: ClipboardList,
    title: "설문으로 의견 수집",
    description: "만족도·자기평가 같은 설문을 만들어 학생 응답을 한곳에 모아요.",
    tone: "sky",
  },
  {
    icon: Wand2,
    title: "AI가 생기부 초안까지",
    description: "패드·퀴즈·설문에 쌓인 활동을 바탕으로 학생별 생활기록부 문안 초안을 정리해요.",
    tone: "sun",
  },
] as const;

export function LandingPage({ authError, initialLoginOpen, loginCallbackUrl }: LandingPageProps) {
  return (
    <HomeAuthActionsProvider
      authError={authError}
      initialLoginOpen={initialLoginOpen}
      loginCallbackUrl={loginCallbackUrl}
    >
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <Link href="/" className={styles.brand} aria-label={`${APP_NAME} 홈`}>
              <Logo size={30} />
              <span>{APP_NAME}</span>
            </Link>
            <nav className={styles.nav} aria-label="공개 홈페이지 메뉴">
              <a href="#features">기능</a>
              <a href="#for-school">학교에서 쓰기</a>
              <Link href="/guide">활용법</Link>
            </nav>
            <div className={styles.headerActions}>
              <ThemeToggle />
              <LoginButton className={styles.loginButton}>로그인</LoginButton>
              <Link href={DASHBOARD_PATH} className={styles.dashboardButton}>
                대시보드 <ArrowRight size={15} aria-hidden />
              </Link>
            </div>
          </div>
        </header>

        <main>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}><Sparkles size={14} aria-hidden />패드·퀴즈·설문이 쌓이면</span>
              <h1>쌓인 활동이,<br /><em>생기부가 됩니다.</em></h1>
              <p>패드로 생각을 모으고, 퀴즈와 설문으로 확인한 수업 활동을 한곳에서 잇습니다. 쌓인 기록은 AI가 학생별 생활기록부 문안 초안으로 정리해요.</p>
              <div className={styles.heroActions}>
                <Link href={DASHBOARD_PATH} className={styles.primaryCta}>
                  지금 시작하기 <ArrowRight size={18} aria-hidden />
                </Link>
                <a href="#features" className={styles.secondaryCta}>어떻게 쓰나요?</a>
              </div>
              <ul className={styles.heroChecks} aria-label="주요 특징">
                <li><Check size={14} aria-hidden />학생은 바로 참여</li>
                <li><Check size={14} aria-hidden />교사는 확인 후 안전하게</li>
                <li><Check size={14} aria-hidden />생기부 초안까지 AI가</li>
              </ul>
            </div>

            <div className={styles.previewWrap} aria-label={`${APP_NAME} 패드 화면 예시`}>
              <span className={styles.previewDotOne} aria-hidden />
              <span className={styles.previewDotTwo} aria-hidden />
              <div className={styles.preview}>
                <div className={styles.previewTopbar}>
                  <span><Logo size={21} /><b>우리 반 생각 모으기</b></span>
                  <div><i /><i /><i /></div>
                </div>
                <div className={styles.previewBody}>
                  <aside className={styles.previewSidebar}>
                    <span className={styles.previewNavActive}><LayoutDashboard size={13} />오늘의 질문</span>
                    <span><BookOpenCheck size={13} />자료 살펴보기</span>
                    <span><MessageCircleMore size={13} />함께 이야기</span>
                  </aside>
                  <div className={styles.previewBoard}>
                    <div className={styles.previewHeading}>
                      <div><small>오늘의 질문</small><b>우리가 바꾸고 싶은 교실은?</b></div>
                      <span><Plus size={13} />글 추가</span>
                    </div>
                    <div className={styles.previewGrid}>
                      <article className={styles.noteMint}>
                        <span>민서</span><b>서로의 이야기를 더 자주 듣는 교실</b><p>작은 의견도 편하게 말할 수 있으면 좋겠어요.</p><small>♡ 12 · 댓글 3</small>
                      </article>
                      <article className={styles.noteViolet}>
                        <span>준호</span><b>함께 만드는 학급 규칙</b><p>우리가 직접 정하면 더 잘 지킬 수 있을 것 같아요.</p><small>♡ 8 · 댓글 5</small>
                      </article>
                      <article className={styles.noteSun}>
                        <span>수빈</span><b>질문을 환영하는 분위기</b><p>모르는 걸 숨기지 않아도 되는 교실이면 좋겠어요.</p><small>♡ 15 · 댓글 4</small>
                      </article>
                      <span className={styles.previewAdd}><Plus size={18} />생각 더하기</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.features} id="features" aria-labelledby="features-title">
            <header className={styles.sectionHeading}>
              <span>한곳에서 이어지는 수업</span>
              <h2 id="features-title">기록부터 생기부까지,<br />흐름을 끊지 않아요.</h2>
            </header>
            <div className={styles.featureGrid}>
              {featureItems.map(({ icon: Icon, title, description, tone }) => (
                <article key={title} className={styles.featureCard} data-tone={tone}>
                  <span className={styles.featureIcon}><Icon size={22} aria-hidden /></span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.schoolSection} id="for-school" aria-labelledby="school-title">
            <div className={styles.schoolCopy}>
              <span className={styles.eyebrow}><Users size={14} aria-hidden />학교 구성원에 맞춘 시작</span>
              <h2 id="school-title">학생은 가볍게,<br />교사는 확인하고 안전하게.</h2>
              <p>학생은 학교·학년·반·번호를 설정해 가볍게 참여합니다. 교사는 학교 관리자 또는 전체관리자의 확인을 받아 패드·퀴즈·설문을 만들고, 쌓인 활동은 생기부 문안을 준비하는 재료로 이어집니다.</p>
              <Link href={DASHBOARD_PATH} className={styles.inlineLink}>내 작업공간 열기 <ArrowRight size={16} aria-hidden /></Link>
            </div>
            <div className={styles.roleCards}>
              <article>
                <span className={styles.studentIcon}><PencilLine size={20} aria-hidden /></span>
                <div><small>STUDENT</small><h3>학생</h3><p>학교와 반 선택</p></div>
                <span className={styles.roleResult}><Check size={14} />바로 참여</span>
              </article>
              <article>
                <span className={styles.teacherIcon}><BookOpenCheck size={20} aria-hidden /></span>
                <div><small>TEACHER</small><h3>교사</h3><p>학교와 부서 선택</p></div>
                <span className={styles.roleResult}><ShieldCheck size={14} />승인 후 운영</span>
              </article>
              <div className={styles.safetyNote}>
                <LockKeyhole size={18} aria-hidden />
                <p><b>링크 공개부터 멤버 전용까지</b><span>패드·퀴즈·설문마다 발견 범위와 읽기·쓰기 권한을 따로 관리할 수 있어요.</span></p>
              </div>
            </div>
          </section>

          <section className={styles.finalCta}>
            <span className={styles.finalIcon}><Eye size={22} aria-hidden /></span>
            <div><h2>오늘의 활동이,<br />생기부로 이어져요.</h2><p>로그인 아이디 또는 카카오로 시작하고, 패드·퀴즈·설문에서 쌓은 활동을 생기부 문안까지 이어가세요.</p></div>
            <Link href={DASHBOARD_PATH}>지금 시작하기 <ArrowRight size={17} aria-hidden /></Link>
          </section>
        </main>
      </div>
    </HomeAuthActionsProvider>
  );
}
