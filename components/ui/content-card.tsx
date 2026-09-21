"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import type { ReactNode } from "react";
import { ContentCardMenu, type ContentCardMenuProps } from "@/components/ui/content-card-menu";
import styles from "@/components/ui/content-card.module.css";

export function ContentCardGrid({ children, adaptive = false }: { children: ReactNode; adaptive?: boolean }) {
  return <div className={`${styles.grid}${adaptive ? ` ${styles.adaptiveGrid}` : ""}`}>{children}</div>;
}

export function ContentCardBadge({ children, tone = "brand", title }: {
  children: ReactNode;
  tone?: "brand" | "warning" | "muted" | "accent";
  title?: string;
}) {
  return <span className={styles.badge} data-tone={tone} title={title}>{children}</span>;
}

/** Pad 목록을 기준으로 한 공용 표면. 각 도메인은 내용·권한·액션만 전달합니다. */
export function ContentCard({ title, href, description, headingLevel = 3, cover, badges, favorite = false, metadata, footerLabel, footerAction, accentColor, menu }: {
  title: string;
  href: string | null;
  description: string;
  headingLevel?: 2 | 3;
  cover?: ReactNode;
  badges: ReactNode;
  favorite?: boolean;
  metadata: ReactNode;
  footerLabel: ReactNode;
  footerAction: ReactNode;
  accentColor?: string;
  menu?: Omit<ContentCardMenuProps, "title">;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const body = <>
    {cover ? <div className={styles.cover}>{cover}</div> : null}
    <div className={styles.body}>
      <div className={styles.top}>
        <span className={styles.badges}>{badges}</span>
        {favorite ? <span className={styles.favorite} aria-label="즐겨찾기"><Star size={14} fill="currentColor" aria-hidden /></span> : null}
      </div>
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.description}>{description}</p>
      <div className={styles.metadata}>{metadata}</div>
    </div>
  </>;
  return (
    <article className={styles.card} data-has-cover={Boolean(cover)} data-has-menu={Boolean(menu)}>
      <span className={styles.accent} style={accentColor ? { backgroundColor: accentColor } : undefined} aria-hidden />
      {href ? <Link href={href} prefetch={false} className={styles.link}>{body}</Link> : <div className={styles.link}>{body}</div>}
      <div className={styles.action}>
        <span className={styles.actionLabel}>{footerLabel}</span>
        <div className={styles.actionControl}>{footerAction}</div>
      </div>
      {menu ? <ContentCardMenu {...menu} title={title} /> : null}
    </article>
  );
}
