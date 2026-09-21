import { ChevronLeft, ChevronRight } from "lucide-react";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

function pageWindow(page: number, totalPages: number) {
  const size = 5;
  const start = Math.max(1, Math.min(page - Math.floor(size / 2), totalPages - size + 1));
  const end = Math.min(totalPages, start + size - 1);
  const numbers: number[] = [];
  for (let value = Math.max(1, start); value <= end; value += 1) numbers.push(value);
  return numbers;
}

export function AdminPageNavigation({ page, totalPages, pending, compact = false, onPageChange }: {
  page: number;
  totalPages: number;
  pending: boolean;
  compact?: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="admin-page-nav">
      <button type="button" className="icon-button" onClick={() => onPageChange(page - 1)} disabled={pending || page <= 1} aria-label="이전 페이지"><ChevronLeft size={16} /></button>
      {compact ? (
        <b className="admin-page-position">{page} / {totalPages}</b>
      ) : pageWindow(page, totalPages).map((value) => (
        <button type="button" key={value} className={value === page ? "admin-page-current" : undefined} onClick={() => onPageChange(value)} disabled={pending} aria-current={value === page ? "page" : undefined}>{value}</button>
      ))}
      <button type="button" className="icon-button" onClick={() => onPageChange(page + 1)} disabled={pending || page >= totalPages} aria-label="다음 페이지"><ChevronRight size={16} /></button>
    </div>
  );
}

export function AdminPagination({ page, pageSize, totalCount, pending, unit = "개", pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS, onPageChange, onPageSizeChange }: {
  page: number;
  pageSize: number;
  totalCount: number;
  pending: boolean;
  unit?: string;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  return (
    <div className="admin-pagination">
      <label className="admin-page-size">페이지당<select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} disabled={pending}>{pageSizeOptions.map((size) => <option key={size} value={size}>{size}{unit}</option>)}</select></label>
      <AdminPageNavigation page={page} totalPages={totalPages} pending={pending} onPageChange={onPageChange} />
      <span className="admin-page-total">총 {totalCount}{unit} · {page} / {totalPages}페이지</span>
    </div>
  );
}
