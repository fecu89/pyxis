"use client";

import dynamic from "next/dynamic";
import styles from "@/components/pad/layouts/layouts.module.css";
import type { ColumnsLayout as ColumnsLayoutType } from "@/components/pad/layouts/columns-layout";
import type { GridLayout as GridLayoutType } from "@/components/pad/layouts/grid-layout";
import type { StreamLayout as StreamLayoutType } from "@/components/pad/layouts/stream-layout";
import type { TableLayout as TableLayoutType } from "@/components/pad/layouts/table-layout";
import type { TimelineLayout as TimelineLayoutType } from "@/components/pad/layouts/timeline-layout";
import type { WallLayout as WallLayoutType } from "@/components/pad/layouts/wall-layout";
import type {
  PadAppearanceStyle,
  LayoutPost,
  LayoutRendererProps,
} from "@/components/pad/layouts/types";

// 보드는 layout 값 하나만 쓰므로 나머지 5개는 항상 안 쓰는 코드입니다. webpack 빌드에서는
// 실제로 청크가 분리됩니다(Turbopack에서는 부모 청크로 합쳐짐 — debug.md 참고). next/dynamic은
// 제네릭 컴포넌트의 타입 파라미터를 못 살리므로, 원래 제네릭 함수 타입으로 다시 캐스팅합니다.
const ColumnsLayout = dynamic(() => import("@/components/pad/layouts/columns-layout").then((mod) => mod.ColumnsLayout)) as unknown as typeof ColumnsLayoutType;
const GridLayout = dynamic(() => import("@/components/pad/layouts/grid-layout").then((mod) => mod.GridLayout)) as unknown as typeof GridLayoutType;
const StreamLayout = dynamic(() => import("@/components/pad/layouts/stream-layout").then((mod) => mod.StreamLayout)) as unknown as typeof StreamLayoutType;
const TableLayout = dynamic(() => import("@/components/pad/layouts/table-layout").then((mod) => mod.TableLayout)) as unknown as typeof TableLayoutType;
const TimelineLayout = dynamic(() => import("@/components/pad/layouts/timeline-layout").then((mod) => mod.TimelineLayout)) as unknown as typeof TimelineLayoutType;
const WallLayout = dynamic(() => import("@/components/pad/layouts/wall-layout").then((mod) => mod.WallLayout)) as unknown as typeof WallLayoutType;

const safeColorPattern = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
const safeImagePathPattern = /^\/(?:files|api)\/[\w?&=./-]+$/;

function safeColor(value: string | null | undefined) {
  return value && safeColorPattern.test(value) ? value : undefined;
}

function safeBackgroundImage(value: string | null | undefined) {
  return value && safeImagePathPattern.test(value) ? `url("${value}")` : undefined;
}

export function PadLayoutRenderer<Post extends LayoutPost>(props: LayoutRendererProps<Post>) {
  const {
    appearance = {},
    layout,
  } = props;
  const style: PadAppearanceStyle = {
    "--board-accent": safeColor(appearance.accentColor),
    "--board-background": safeColor(appearance.backgroundColor),
    "--board-background-image": safeBackgroundImage(appearance.backgroundImageUrl),
  };
  let content;
  switch (layout) {
    case "WALL":
      content = <WallLayout {...props} />;
      break;
    case "GRID":
      content = <GridLayout {...props} />;
      break;
    case "STREAM":
      content = <StreamLayout {...props} />;
      break;
    case "TIMELINE":
      content = <TimelineLayout {...props} />;
      break;
    case "TABLE":
      content = <TableLayout {...props} />;
      break;
    default:
      content = <ColumnsLayout {...props} />;
  }

  return (
    <div
      className={styles.appearance}
      data-card-size={appearance.cardSize ?? "MEDIUM"}
      data-font={appearance.font ?? "SANS"}
      style={style}
    >
      <div className={styles.surface}>{content}</div>
    </div>
  );
}
