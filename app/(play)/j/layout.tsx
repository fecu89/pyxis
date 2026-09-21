import type { ReactNode } from "react";
import { getMetadata } from "@/utils/seo/getMetadata";

// /join 은 "use client" 화면이라 페이지에서 metadata를 내보낼 수 없어 레이아웃에서 지정합니다.
// PIN 입력 화면 자체는 공개 정보만 담고 있으므로 색인을 허용합니다.
export const metadata = getMetadata({
  title: "PIN으로 퀴즈 참여하기",
  description: "선생님이 알려준 6자리 PIN을 입력하면 바로 퀴즈에 참여할 수 있어요.",
  asPath: "/j",
  keywords: ["퀴즈 참여", "PIN 입력"],
});

export default function JoinLayout({ children }: { children: ReactNode }) {
  return children;
}
