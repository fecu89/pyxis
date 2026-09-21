import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ContentCard, ContentCardBadge, ContentCardGrid } from "@/components/ui/content-card";
import { EmptyState } from "@/components/ui/feedback";
import type { LearningPage } from "@/lib/learning/types";
import { LEARNING_LABELS } from "@/lib/learning/types";

export function LearningItems({ data }: { data: LearningPage }) {
  if (!data.items.length) return <EmptyState
    title={`아직 참여할 ${LEARNING_LABELS[data.kind]}이 없어요`}
    description={data.kind === "quiz" ? "교과목의 라이브 수업과 선생님이 할당한 자율 풀이 과제가 여기에 표시됩니다." : "참여할 수 있는 활동이 생기면 여기에 표시됩니다."}
  />;
  return <ContentCardGrid adaptive>
    {data.items.map(item => <ContentCard
      key={item.id}
      title={item.title}
      href={item.href}
      description={item.description || `${item.subjectName || "내 수업"} ${LEARNING_LABELS[data.kind]}`}
      badges={<>{item.mode ? <ContentCardBadge tone={item.mode === "LIVE" ? "accent" : "brand"}>{item.mode === "LIVE" ? "라이브" : "자율 풀이 과제"}</ContentCardBadge> : null}<ContentCardBadge tone={item.href ? "brand" : "muted"}>{item.status}</ContentCardBadge></>}
      metadata={<span>{item.subjectName || "교과목 미지정"}</span>}
      footerLabel={item.mode === "LIVE" ? "수업 참여" : item.mode === "ASYNC" ? "개인 과제" : LEARNING_LABELS[data.kind]}
      footerAction={item.href
        ? <Link href={item.href} prefetch={false}>{item.action}<ArrowUpRight size={14} aria-hidden /></Link>
        : <span className="text-xs text-content-muted">{item.status}</span>}
    />)}
  </ContentCardGrid>;
}
