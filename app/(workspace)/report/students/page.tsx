import Link from "next/link";
import { ClipboardCheck, ClipboardList, GraduationCap, Search, StickyNote, Users } from "lucide-react";
import { AutoSubmitClassSelect } from "@/components/report/auto-submit-class-select";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getReportStudentPage } from "@/lib/activity/students";
import { href } from "@/lib/routes";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({
  title: "학생 기록",
  description: "학생을 골라 퀴즈·패드·설문 활동을 함께 봅니다.",
  noIndex: true,
});

type SearchParams = { page?: string | string[]; q?: string | string[]; classId?: string | string[] };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * 학생 목록. 고르면 그 학생의 퀴즈·패드 기록으로 들어갑니다.
 *
 * 계정 자체(이름·번호·비밀번호)를 다루는 화면은 `/admin`의 회원·명렬 탭입니다. 여기는 읽기
 * 전용이고, 그래서 계정 발급 권한이 아니라 리포트 범위(같은 학교 교사면 가능)로 판정합니다.
 */
export default async function ReportStudentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/report/students");
  const params = await searchParams;
  const query = first(params.q) ?? "";
  const schoolGroupId = first(params.classId) ?? "";
  const { students, schoolGroups, total, page, pageSize, searchTruncated } = await getReportStudentPage(user, {
    page: Number(first(params.page)) || 1,
    query,
    schoolGroupId,
  });
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <PageShell size="wide">
      <PageHeader
        eyebrow="Student records"
        title="학생 기록"
        description="학생을 고르면 퀴즈 응시, 패드 글, 설문 응답을 한 화면에서 볼 수 있습니다."
        action={
          <Link href={href("reportMyHistory")} className="button">내 기록 보기</Link>
        }
      />

      <form className="report-student-search" action="/report/students">
        <label>
          <span className="app-sidebar-visually-hidden">학생 이름</span>
          <Search size={16} aria-hidden />
          <input name="q" defaultValue={query} placeholder="이름, 아이디, 출석번호" maxLength={60} />
        </label>
        <label className="report-student-class-filter">
          <span className="app-sidebar-visually-hidden">학급</span>
          <GraduationCap size={16} aria-hidden />
          <AutoSubmitClassSelect value={schoolGroupId} options={schoolGroups} />
        </label>
        <button type="submit" className="button primary">검색</button>
        {(query || schoolGroupId) && <Link href="/report/students" className="button">필터 초기화</Link>}
      </form>

      {searchTruncated && <p className="mb-4 rounded-lg border border-warning-300 bg-warning-50 px-3 py-2 text-sm font-bold text-warning-900" role="status">검색 범위가 넓어 일부만 확인했습니다. 학급이나 검색어를 더 구체적으로 입력해 주세요.</p>}

      {students.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={query || schoolGroupId ? "조건에 맞는 학생이 없어요" : "볼 수 있는 학생이 없어요"}
          description={query || schoolGroupId
            ? "이름, 아이디, 출석번호나 학급 조건을 바꾸거나 필터를 초기화해 보세요."
            : "같은 학교 학생만 볼 수 있습니다. 소속이 아직 없다면 관리자에게 문의해 주세요."}
        />
      ) : (
        <>
          <ul className="report-student-list">
            {students.map((student) => (
              <li key={student.id}>
                <Link href={href("reportStudent", { studentId: student.id })}>
                  <span className="report-student-name">
                    <b>{student.name}</b>
                    {student.schoolGroupName && <small>{student.schoolGroupName}</small>}
                  </span>
                  <span className="report-student-counts">
                    <span><ClipboardList size={14} aria-hidden />퀴즈 {student.quizCount}</span>
                    <span><StickyNote size={14} aria-hidden />패드 글 {student.postCount}</span>
                    <span><ClipboardCheck size={14} aria-hidden />설문 {student.formResponseCount}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <PageNumberNavigation
            basePath="/report/students"
            page={page}
            totalPages={lastPage}
            params={{ q: query, classId: schoolGroupId }}
          />
        </>
      )}
    </PageShell>
  );
}
