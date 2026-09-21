import { EmptySection, SectionTag } from "@/components/pad/layouts/layout-parts";
import styles from "@/components/pad/layouts/layouts.module.css";
import type {
  LayoutPost,
  LayoutRendererProps,
} from "@/components/pad/layouts/types";

const timelineDateFormatter = new Intl.DateTimeFormat("ko", { month: "short", day: "numeric", timeZone: "Asia/Seoul" });

export function TimelineLayout<Post extends LayoutPost>({
  sections,
  renderPost,
  onEditSection,
}: Omit<LayoutRendererProps<Post>, "layout" | "appearance" | "sortMode" | "newPostPlacement" | "renderAddPost" | "renderSectionActions" | "renderAddSection">) {
  const entries = sections
    .flatMap((section) => section.posts.map((post, index) => ({ section, post, index })))
    .sort((left, right) => left.post.createdAt.localeCompare(right.post.createdAt) || left.post.id.localeCompare(right.post.id));
  if (!entries.length) return <EmptySection title="패드" />;
  return (
    <div className={styles.timeline} aria-label="타임라인형 패드">
      {entries.map(({ section, post, index }) => (
        <div className={styles.timelineItem} key={post.id}>
          <time className={styles.timelineTime} dateTime={post.createdAt}>
            {timelineDateFormatter.format(new Date(post.createdAt))}
          </time>
          <div>
            <SectionTag section={section} onEditSection={onEditSection} className={styles.sectionTag} />
            {renderPost(post, { section, index, dragDisabled: true })}
          </div>
        </div>
      ))}
    </div>
  );
}
