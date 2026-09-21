import type { ReactNode } from "react";
import styles from "@/components/pad/layouts/layouts.module.css";
import type {
  LayoutPost,
  LayoutSection,
} from "@/components/pad/layouts/types";

export function SectionHeader<Post extends LayoutPost>({
  section,
  actions,
  onEditSection,
}: {
  section: LayoutSection<Post>;
  actions?: ReactNode;
  onEditSection?: (section: LayoutSection<Post>) => void;
}) {
  return (
    <header className={styles.sectionHeader}>
      {/* 설명은 여기서 더 이상 보여주지 않습니다(사용자 피드백 — 섹션 설명이 너무 길어서 제목만
          남김). 안내 문구는 여전히 저장되고 더블클릭으로 여는 편집 화면에서 바꿀 수 있습니다. */}
      <div
        onDoubleClick={onEditSection ? () => onEditSection(section) : undefined}
        title={onEditSection ? "더블클릭하면 제목·안내 문구를 바꿀 수 있어요" : undefined}
      >
        <h2>{section.title}</h2>
      </div>
      <span className={styles.count} aria-label={`게시물 ${section.posts.length}개`}>
        {section.posts.length}
      </span>
      {actions}
    </header>
  );
}

// 5개 레이아웃(테이블은 2곳)이 "더블클릭하면 편집" 섹션 태그를 각자 복붙해 쓰다가
// stream-layout만 styles.sectionTag 클래스가 빠지는 등 스타일이 서서히 벌어졌다. 하나로 통일한다.
export function SectionTag<Post extends LayoutPost>({
  section,
  onEditSection,
  as: Tag = "span",
  className,
}: {
  section: LayoutSection<Post>;
  onEditSection?: (section: LayoutSection<Post>) => void;
  as?: "span" | "strong";
  className?: string;
}) {
  return (
    <Tag
      className={className}
      onDoubleClick={onEditSection ? () => onEditSection(section) : undefined}
      title={onEditSection ? "더블클릭하면 제목·안내 문구를 바꿀 수 있어요" : undefined}
    >
      {section.title}
    </Tag>
  );
}

export function EmptySection({ title }: { title: string }) {
  return (
    <div className={styles.empty}>
      <strong>{title}에 아직 게시물이 없습니다.</strong>
      <span>첫 번째 생각을 남겨보세요.</span>
    </div>
  );
}
