import Link from "next/link";
import { EmptyState } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/data-display";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import { getActivityPage, type ReportActivityType } from "@/lib/activity/report";
import { REPORT_ACTIVITY_PATHS } from "@/lib/activity/report-navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { formatDateTime } from "@/lib/format";

export type ActivityReportSearchParams = Promise<{ page?: string | string[] }>;

export async function renderActivityReportPage(searchParams: ActivityReportSearchParams, type?: ReportActivityType) {
  const basePath = type ? REPORT_ACTIVITY_PATHS[type] : "/report";
  const user = await getCurrentUser();
  if (!user) redirectToLogin(basePath);
  const rawPage = (await searchParams).page;
  const requestedPage = Number(Array.isArray(rawPage) ? rawPage[0] : rawPage) || 1;
  const { items, total, page, pageSize } = await getActivityPage(user, { page: requestedPage, type });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (items.length === 0) {
    return <EmptyState title="아직 활동이 없어요" description="퀴즈 세션을 열거나 패드·설문을 만들면 여기에 쌓입니다." />;
  }
  return (
    <>
      <ul className="grid gap-2">
        {items.map((item) => <li key={item.id}><ActivityRowView item={item} /></li>)}
      </ul>
      <PageNumberNavigation basePath={basePath} page={page} totalPages={totalPages} />
    </>
  );
}

const ACTIVITY_LOOKS = {
  QUIZ_SESSION: { badge: "LIVE", label: "퀴즈", unit: "참여" },
  PAD_BOARD: { badge: "PUBLISHED", label: "패드", unit: "글" },
  FORM: { badge: "FORM", label: "설문", unit: "응답" },
} as const;

function ActivityRowView({ item }: { item: Awaited<ReturnType<typeof getActivityPage>>["items"][number] }) {
  const look = ACTIVITY_LOOKS[item.type];
  const body = (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition hover:bg-surface-hover">
      <StatusBadge status={look.badge} label={look.label} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-content">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-content-muted">{[item.ownerName, item.schoolGroupName, formatDateTime(item.createdAt)].filter(Boolean).join(" · ")}</p>
      </div>
      <span className="shrink-0 text-xs font-bold text-content-muted">{look.unit} {item.participantCount}</span>
    </div>
  );
  return item.href ? <Link href={item.href}>{body}</Link> : body;
}
