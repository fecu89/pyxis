"use client";

import { AlertIcon } from "@/components/ui/icons";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="grid flex-1 place-items-center px-4 py-12"><section className="w-full max-w-lg rounded-[30px] border border-line bg-surface p-8 text-center shadow-xl shadow-scrim/5"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-danger-soft text-danger-soft-fg"><AlertIcon className="h-7 w-7" /></div><h1 className="mt-6 text-2xl font-black tracking-tight text-content">화면을 불러오지 못했어요</h1><p className="mt-3 text-sm leading-6 text-content-muted">잠시 후 다시 시도해 주세요. 문제가 계속되면 이전 화면으로 돌아가 주세요.</p><button type="button" onClick={reset} className="mt-7 rounded-xl bg-brand-strong px-5 py-3 text-sm font-black text-on-brand">다시 시도</button></section></main>;
}
