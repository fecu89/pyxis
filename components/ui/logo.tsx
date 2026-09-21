import Image from "next/image";
import clsx from "clsx";

// 예전에는 위치마다 달랐던 CSS 도형을 실제 로고 파일을 쓰는 이 컴포넌트 하나로 통일했습니다.
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return <Image src="/logo.svg" alt="" aria-hidden width={size} height={size} className={clsx("site-logo", className)} style={{ flexShrink: 0 }} />;
}
