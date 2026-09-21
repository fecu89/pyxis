import Link from "next/link";

export default function NotFound() {
  return <main className="empty-page"><div className="empty-illustration">404</div><h1>이 패드를 찾을 수 없어요</h1><p>주소가 바뀌었거나 볼 수 없는 패드일 수 있어요.</p><Link className="button primary" href="/">패드 홈으로</Link></main>;
}
