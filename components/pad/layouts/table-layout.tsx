import { EmptySection, SectionTag } from "@/components/pad/layouts/layout-parts";
import styles from "@/components/pad/layouts/layouts.module.css";
import { sortLayoutPosts } from "@/components/pad/layouts/sort-posts";
import type {
  LayoutPost,
  LayoutRendererProps,
} from "@/components/pad/layouts/types";

export function TableLayout<Post extends LayoutPost>({
  sections,
  sortMode = "MANUAL",
  newPostPlacement = "END",
  renderPost,
  renderAddPost,
  renderSectionActions,
  renderAddSection,
  tableColumns = [],
  onEditSection,
}: Omit<LayoutRendererProps<Post>, "layout" | "appearance">) {
  const dragDisabled = sortMode !== "MANUAL";
  const columnCount = 2 + tableColumns.length;

  return (
    <>
      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>패드 게시물 표</caption>
          <thead>
            <tr>
              <th scope="col">섹션</th>
              <th scope="col">게시물</th>
              {tableColumns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}
            </tr>
          </thead>
          {sections.map((section) => {
            const posts = sortLayoutPosts(section.posts, sortMode, newPostPlacement);
            const sectionRowCount = Math.max(1, posts.length) + (renderAddPost ? 1 : 0);
            return (
              <tbody key={section.id}>
                {posts.map((post, index) => (
                  <tr key={post.id}>
                    {index === 0 && (
                      <th className={styles.tableSection} scope="rowgroup" rowSpan={sectionRowCount}>
                        <SectionTag section={section} onEditSection={onEditSection} as="strong" />
                        <small>{section.posts.length}개</small>
                        {renderSectionActions?.(section)}
                      </th>
                    )}
                    <td className={styles.tablePost}>
                      {renderPost(post, { section, index, dragDisabled })}
                    </td>
                    {tableColumns.map((column) => {
                      const value = column.render(post);
                      const empty = value === null || value === undefined || value === "";
                      return (
                        <td className={styles.tableValue} key={column.key}>
                          {empty ? <span aria-label="값 없음">—</span> : value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!posts.length && (
                  <tr>
                    <th className={styles.tableSection} scope="row" rowSpan={sectionRowCount}>
                      <SectionTag section={section} onEditSection={onEditSection} as="strong" />
                      {renderSectionActions?.(section)}
                    </th>
                    <td colSpan={columnCount - 1}><EmptySection title={section.title} /></td>
                  </tr>
                )}
                {renderAddPost && (
                  <tr>
                    <td className={styles.tableAdd} colSpan={columnCount - 1}>
                      {renderAddPost(section)}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>
      {renderAddSection && <div className={styles.sectionAdd}>{renderAddSection()}</div>}
    </>
  );
}
