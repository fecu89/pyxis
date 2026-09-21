"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { suffix: "", label: "요약" },
  { suffix: "questions", label: "질문별" },
  { suffix: "individual", label: "개별" },
] as const;

export function FormResponseNav({ formId }: { formId: string }) {
  const pathname = usePathname();
  const basePath = `/forms/${formId}/responses`;
  return (
    <nav aria-label="응답 보기" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-inset p-1">
      {ITEMS.map((item) => {
        const href = item.suffix ? `${basePath}/${item.suffix}` : basePath;
        const active = pathname === href;
        return (
          <Link
            key={item.suffix}
            href={href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-black transition ${active ? "bg-surface text-content shadow-sm" : "text-content-muted hover:text-content"}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
