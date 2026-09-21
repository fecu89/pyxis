export type ResourceManagerFilters<SortBy extends string> = {
  search: string;
  ownerAccount: string;
  updatedFrom: string;
  updatedTo: string;
  includeArchived: boolean;
  sortBy: SortBy;
  sortDir: "asc" | "desc";
};

export function resourceManagerQuery<SortBy extends string>(page: number, pageSize: number, filters: ResourceManagerFilters<SortBy>) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sortBy: filters.sortBy, sortDir: filters.sortDir });
  if (filters.search.trim()) query.set("search", filters.search.trim());
  const account = filters.ownerAccount.trim();
  if (account) query.set(account.includes("@") ? "ownerEmail" : "ownerLoginId", account);
  if (filters.updatedFrom) query.set("updatedFrom", filters.updatedFrom);
  if (filters.updatedTo) query.set("updatedTo", filters.updatedTo);
  if (filters.includeArchived) query.set("includeArchived", "true");
  return query;
}
