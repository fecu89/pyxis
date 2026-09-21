import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getFormListPage, parseFormListParams } from "@/lib/forms/list";
import { FORM_LIST_PATHS, type FormListView } from "@/lib/forms/navigation";

export type FormListSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function renderFormListPage(searchParams: FormListSearchParams, view: FormListView) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin(FORM_LIST_PATHS[view]);
  if (user.role === "STUDENT") {
    const { LearningListPage } = await import("@/components/learning/learning-page");
    const query = await searchParams;
    return <LearningListPage user={user} kind="form" page={Number(query.page)} basePath={FORM_LIST_PATHS[view]} />;
  }

  const { LazyFormList: FormList } = await import("@/components/learning/lazy-management");
  const params = parseFormListParams(await searchParams, view);
  const data = await getFormListPage(user, params);
  return (
    <FormList
      key={`${view}:${params.query}:${params.sort}`}
      forms={data.items}
      counts={data.counts}
      view={params.view}
      page={data.page}
      total={data.total}
      totalPages={data.totalPages}
      query={params.query}
      sort={params.sort}
    />
  );
}
