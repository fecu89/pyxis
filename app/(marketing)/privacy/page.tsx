import Link from "next/link";
import { LegalDocument } from "@/components/auth/legal-document";
export const metadata = { title: "개인정보 처리방침 · pyxis" };
export default function PrivacyPage() {
  return <main className="legal-page"><nav><Link href="/">pyxis 홈</Link><Link href="/terms">이용약관</Link></nav><h1>개인정보 처리방침</h1><LegalDocument kind="privacy" /></main>;
}
