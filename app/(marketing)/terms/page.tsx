import Link from "next/link";
import { LegalDocument } from "@/components/auth/legal-document";
export const metadata = { title: "이용약관 · pyxis" };
export default function TermsPage() {
  return <main className="legal-page"><nav><Link href="/">pyxis 홈</Link><Link href="/privacy">개인정보 처리방침</Link></nav><h1>이용약관</h1><LegalDocument kind="terms" /></main>;
}
