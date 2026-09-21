import { Logo } from "@/components/ui/logo";

export default function PostLoading() {
  return (
    <main className="post-page post-page-loading" aria-busy="true" aria-label="게시물을 불러오는 중">
      <header className="post-page-nav"><span /><Logo size={23} className="pulse" /><span /></header>
      <div className="post-page-shell">
        <div className="post-loading-line short" />
        <div className="post-page-layout">
          <article className="post-page-article">
            <div className="post-page-heading"><div className="post-loading-line label" /><div className="post-loading-line title" /><div className="post-loading-line medium" /></div>
            <div className="post-page-body"><div className="post-loading-line" /><div className="post-loading-line" /><div className="post-loading-line medium" /></div>
          </article>
          <aside className="comments-panel post-page-comments"><header /><div className="comments-scroll"><div className="post-loading-line" /><div className="post-loading-line medium" /></div></aside>
        </div>
      </div>
    </main>
  );
}
