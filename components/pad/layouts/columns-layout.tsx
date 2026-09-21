import { EmptySection, SectionHeader } from "@/components/pad/layouts/layout-parts";
import styles from "@/components/pad/layouts/layouts.module.css";
import { sortLayoutPosts } from "@/components/pad/layouts/sort-posts";
import type {
  LayoutPost,
  LayoutRendererProps,
} from "@/components/pad/layouts/types";

export function ColumnsLayout<Post extends LayoutPost>({
  sections,
  sortMode = "MANUAL",
  newPostPlacement = "END",
  renderPost,
  renderAddPost,
  renderSectionActions,
  renderAddSection,
  onEditSection,
}: Omit<LayoutRendererProps<Post>, "layout" | "appearance">) {
  const dragDisabled = sortMode !== "MANUAL";
  return (
    <>
      <div className={styles.columns} aria-label="섹션형 패드">
        {sections.map((section) => {
          const posts = sortLayoutPosts(section.posts, sortMode, newPostPlacement);
          return (
            <section className={styles.column} key={section.id} aria-labelledby={`section-${section.id}`}>
              <div id={`section-${section.id}`}>
                <SectionHeader section={section} actions={renderSectionActions?.(section)} onEditSection={onEditSection} />
              </div>
              <div className={styles.postStack}>
                {posts.map((post, index) => renderPost(post, { section, index, dragDisabled }))}
                {!posts.length && <EmptySection title={section.title} />}
              </div>
              {renderAddPost && <footer className={styles.addArea}>{renderAddPost(section)}</footer>}
            </section>
          );
        })}
      </div>
      {renderAddSection && <div className={styles.sectionAdd}>{renderAddSection()}</div>}
    </>
  );
}
