import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/ui/icons";

// 페이지 폭과 기본 여백은 제품별 화면에서 직접 반복하지 않고 이 경계에서 통일합니다.
export function PageShell({ children, size = "wide", className = "" }: { children: ReactNode; size?: "wide" | "medium" | "narrow"; className?: string }) {
  const width = size === "narrow" ? "max-w-2xl" : size === "medium" ? "max-w-4xl" : "max-w-[1220px]";
  return <main className={`mx-auto w-full ${width} flex-1 px-4 py-5 sm:px-6 sm:py-7 ${className}`}>{children}</main>;
}

export function BackLink({ href, children = "돌아가기" }: { href: string; children?: ReactNode }) {
  return <Link href={href} className="mb-5 inline-flex items-center gap-1.5 text-sm font-bold text-content-muted transition hover:text-brand"><ArrowLeftIcon className="h-4 w-4" />{children}</Link>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow && <p className="mb-2 text-xs font-black uppercase tracking-normal text-brand">{eyebrow}</p>}
        <h1 className="text-3xl font-black tracking-normal text-content sm:text-4xl">{title}</h1>
        {description && <p className="mt-3 max-w-2xl text-sm leading-6 text-content-muted sm:text-base">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-strong px-5 py-3 text-sm font-black text-on-brand shadow-sm transition hover:-translate-y-0.5 hover:opacity-90"><span>{children}</span><ArrowRightIcon className="h-4 w-4" /></Link>;
}
