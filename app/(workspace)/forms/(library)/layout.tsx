import type { ReactNode } from "react";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "설문", description: "설문지를 만들고 링크로 응답을 받습니다.", noIndex: true });

/** 학생 응답 목록과 관리 목록은 form-list-page에서 서버 권한에 따라 분기합니다. */
export default async function FormLibraryLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
