import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { LearningPage } from "@/lib/learning/types";
import { LEARNING_LABELS } from "@/lib/learning/types";

export function LearningItems({ data }: { data: LearningPage }) {
  if (!data.items.length) return <p className="rounded-2xl border border-dashed border-line p-6 text-sm leading-6 text-content-muted">
    {data.kind === "quiz" ? "아직 내게 할당된 퀴즈가 없습니다. 교과목에 연결된 퀴즈도 선생님이 학생에게 할당하면 여기에서 풀 수 있어요."
      : `참여할 수 있는 ${LEARNING_LABELS[data.kind]}이 아직 없습니다.`}
  </p>;
  return <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
    {data.items.map(item => {
      const content = <>
        <span className="flex items-center justify-between gap-2 text-xs font-bold text-content-muted">
          <span className="min-w-0 truncate">{item.subjectName || LEARNING_LABELS[data.kind]}</span>
          <span className="shrink-0 rounded-lg bg-brand-soft px-2 py-1 text-brand-soft-fg">{item.status}</span>
        </span>
        <h3 className="mt-3 line-clamp-2 break-words text-base font-black text-content">{item.title}</h3>
        {item.description ? <p className="mt-2 line-clamp-2 break-words text-sm text-content-muted">{item.description}</p> : null}
        <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-brand">
          {item.href ? item.action : item.status}<ArrowUpRight size={15} aria-hidden />
        </span>
      </>;
      const className = "block h-full min-w-0 rounded-2xl border border-line bg-surface p-4 transition hover:bg-surface-hover";
      return <li key={item.id} className="min-w-0">{item.href
        ? <Link href={item.href} prefetch={false} className={className}>{content}</Link>
        : <article className={className}>{content}</article>}
      </li>;
    })}
  </ul>;
}
