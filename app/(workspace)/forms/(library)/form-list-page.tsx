import { FormList } from "@/components/forms/form-list";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getFormListPage, parseFormListParams } from "@/lib/forms/list";
import { FORM_LIST_PATHS, type FormListView } from "@/lib/forms/navigation";

export type FormListSearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function renderFormListPage(searchParams: FormListSearchParams, view: FormListView) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin(FORM_LIST_PATHS[view]);
  // layout이 학생용 권한 안내를 렌더링하므로 목록 쿼리는 실행하지 않습니다.
  if (user.role === "STUDENT") return null;

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
