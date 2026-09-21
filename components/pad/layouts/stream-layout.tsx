import { EmptySection, SectionTag } from "@/components/pad/layouts/layout-parts";
import styles from "@/components/pad/layouts/layouts.module.css";
import { sortLayoutPosts } from "@/components/pad/layouts/sort-posts";
import type {
  LayoutPost,
  LayoutRendererProps,
} from "@/components/pad/layouts/types";

const streamDateFormatter = new Intl.DateTimeFormat("ko", { dateStyle: "medium", timeZone: "Asia/Seoul" });

export function StreamLayout<Post extends LayoutPost>({
  sections,
  sortMode = "CREATED_DESC",
  newPostPlacement = "END",
  renderPost,
  onEditSection,
}: Omit<LayoutRendererProps<Post>, "layout" | "appearance" | "renderAddPost" | "renderSectionActions" | "renderAddSection">) {
  const entries = sections
    .flatMap((section) => sortLayoutPosts(section.posts, sortMode, newPostPlacement)
      .map((post, index) => ({ section, post, index })))
    .sort((left, right) => right.post.createdAt.localeCompare(left.post.createdAt));
  if (!entries.length) return <EmptySection title="패드" />;
  return (
    <div className={styles.stream} aria-label="스트림형 패드">
      {entries.map(({ section, post, index }) => (
        <div className={styles.streamItem} key={post.id}>
          <header className={styles.streamMeta}>
            <SectionTag section={section} onEditSection={onEditSection} as="strong" className={styles.sectionTag} />
            <span>{streamDateFormatter.format(new Date(post.createdAt))}</span>
          </header>
          <div>{renderPost(post, { section, index, dragDisabled: true })}</div>
        </div>
      ))}
    </div>
  );
}
