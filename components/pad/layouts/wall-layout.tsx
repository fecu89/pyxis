import { EmptySection, SectionTag } from "@/components/pad/layouts/layout-parts";
import styles from "@/components/pad/layouts/layouts.module.css";
import { sortLayoutPosts } from "@/components/pad/layouts/sort-posts";
import type {
  LayoutPost,
  LayoutRendererProps,
} from "@/components/pad/layouts/types";

export function WallLayout<Post extends LayoutPost>({
  sections,
  sortMode = "MANUAL",
  newPostPlacement = "END",
  renderPost,
  renderAddPost,
  onEditSection,
}: Omit<LayoutRendererProps<Post>, "layout" | "appearance" | "renderSectionActions" | "renderAddSection">) {
  return (
    <div className={styles.wall} aria-label="벽형 패드">
      {sections.map((section) => {
        const posts = sortLayoutPosts(section.posts, sortMode, newPostPlacement);
        if (!posts.length) {
          return (
            <section className={styles.wallItem} key={section.id}>
              <SectionTag section={section} onEditSection={onEditSection} className={styles.sectionTag} />
              <EmptySection title={section.title} />
              {renderAddPost?.(section)}
            </section>
          );
        }
        return posts.map((post, index) => (
          <div className={styles.wallItem} key={post.id}>
            <SectionTag section={section} onEditSection={onEditSection} className={styles.sectionTag} />
            {renderPost(post, { section, index, dragDisabled: true })}
          </div>
        ));
      })}
    </div>
  );
}
