export default function BoardLoading() {
  return <main className="board-skeleton"><header /><section /><div>{[0, 1, 2].map((item) => <article key={item}><span /><span /><span /></article>)}</div></main>;
}
