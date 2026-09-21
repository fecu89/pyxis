import { EmptySection, SectionTag } from "@/components/pad/layouts/layout-parts";
import styles from "@/components/pad/layouts/layouts.module.css";
import { sortLayoutPosts } from "@/components/pad/layouts/sort-posts";
import type {
  LayoutPost,
  LayoutRendererProps,
} from "@/components/pad/layouts/types";

export function GridLayout<Post extends LayoutPost>({
  sections,
  sortMode = "MANUAL",
  newPostPlacement = "END",
  renderPost,
  onEditSection,
}: Omit<LayoutRendererProps<Post>, "layout" | "appearance" | "renderAddPost" | "renderSectionActions" | "renderAddSection">) {
  const entries = sections.flatMap((section) => (
    sortLayoutPosts(section.posts, sortMode, newPostPlacement)
      .map((post, index) => ({ section, post, index }))
  ));
  if (!entries.length) return <EmptySection title="패드" />;
  return (
    <div className={styles.grid} aria-label="격자형 패드">
      {entries.map(({ section, post, index }) => (
        <div className={styles.gridItem} key={post.id}>
          <SectionTag section={section} onEditSection={onEditSection} className={styles.sectionTag} />
          {renderPost(post, { section, index, dragDisabled: true })}
        </div>
      ))}
    </div>
  );
}
