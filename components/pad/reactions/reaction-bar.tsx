"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, SmilePlus } from "lucide-react";
import styles from "@/components/pad/reactions/reaction-bar.module.css";
import {
  defaultReactionOptions,
  type ReactionCounts,
  type ReactionKey,
  type ReactionPolicy,
} from "@/components/pad/reactions/types";

const suggestedEmoji = ["👏", "🔥", "💡", "✅", "🤔", "🙌", "💯", "🌟", "🚀", "📌"];
const MENU_WIDTH = 210;
const MENU_HEIGHT = 230;

type OptimisticReactionState = {
  baseSnapshot: string;
  counts: ReactionCounts;
  viewer: ReactionKey[];
};

type MenuPosition = { top: number; left: number; openUpward: boolean };

function reactionSnapshot(counts: ReactionCounts, viewer: ReactionKey[]) {
  const countEntries = Object.entries(counts)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify([countEntries, [...viewer].sort()]);
}

function reactionEmoji(key: ReactionKey) {
  if (key.startsWith("EMOJI:")) return key.slice(6);
  return defaultReactionOptions.find((option) => option.key === key)?.emoji ?? "👍";
}

function reactionLabel(key: ReactionKey) {
  if (key.startsWith("EMOJI:")) return `${key.slice(6)} 반응`;
  return defaultReactionOptions.find((option) => option.key === key)?.label ?? key;
}

// 팝오버 위치는 트리거 버튼 기준 뷰포트 좌표로 계산합니다(카드 안 상대 위치가 아니라).
// 오른쪽 정렬이 기본이지만 화면 왼쪽으로 넘치면 clamp하고, 위쪽에 공간이 부족하면 아래로 엽니다.
function computeMenuPosition(trigger: HTMLElement): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const openUpward = rect.top > MENU_HEIGHT + 12;
  const rawLeft = rect.right - MENU_WIDTH;
  const left = Math.min(Math.max(rawLeft, 8), window.innerWidth - MENU_WIDTH - 8);
  const top = openUpward ? rect.top - 8 : rect.bottom + 8;
  return { top, left, openUpward };
}

export function ReactionBar({
  counts,
  viewerReactions,
  policy = "SINGLE",
  canReact,
  customEmoji = suggestedEmoji,
  onToggle,
}: {
  counts: ReactionCounts;
  viewerReactions: ReactionKey[];
  policy?: ReactionPolicy;
  canReact: boolean;
  customEmoji?: string[];
  onToggle: (reaction: ReactionKey, active: boolean) => Promise<ReactionCounts | void>;
}) {
  const [optimistic, setOptimistic] = useState<OptimisticReactionState | null>(null);
  const [pending, setPending] = useState<ReactionKey | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLSpanElement>(null);
  const sourceSnapshot = useMemo(
    () => reactionSnapshot(counts, viewerReactions),
    [counts, viewerReactions],
  );
  const currentOptimistic = optimistic?.baseSnapshot === sourceSnapshot ? optimistic : null;
  const visibleCounts = currentOptimistic?.counts ?? counts;
  const visibleViewer = currentOptimistic?.viewer ?? viewerReactions;
  // 기본 반응 5종을 항상 인라인으로 다 띄우지 않고, 실제로 개수가 있거나 내가 누른 반응만
  // 보여줍니다("왜 쓸데없이 이렇게 많냐"는 피드백 반영). 새 반응은 SmilePlus 트리거를 눌러야
  // 나오는 팝오버(기본 5종 + 커스텀 이모지)에서 고릅니다.
  const activeKeys = useMemo(() => Array.from(new Set<ReactionKey>([
    ...(Object.entries(visibleCounts) as [ReactionKey, number | undefined][])
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([key]) => key),
    ...visibleViewer,
  ])), [visibleCounts, visibleViewer]);

  // 팝오버는 게시물 카드(.post-list, overflow-y:auto)나 게시물 상세 모달(.modal-panel,
  // overflow:auto) 안에 그대로 두면 그 조상의 스크롤 영역 밖으로 나가는 순간 잘려서 보였습니다
  // ("왼쪽에 뜨면서 div 밖으로 벗어나서 가려짐" — CSS 스펙상 overflow-y만 auto여도 overflow-x가
  // 자동으로 auto가 되어 같이 잘립니다). document.body로 포털을 띄우고 트리거의 뷰포트 좌표로
  // 직접 위치를 계산해 이 문제를 완전히 피합니다(드래그 미리보기에 쓴 DragOverlay와 같은 이유).
  useEffect(() => {
    function reposition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setMenuPosition(computeMenuPosition(trigger));
    }
    // 이펙트 본문에서 setState를 곧바로 부르지 않고 마이크로태스크로 미룹니다
    // (react-hooks/set-state-in-effect — 이 세션에서 반복된 패턴).
    queueMicrotask(() => { if (!pickerOpen) setMenuPosition(null); else reposition(); });
    if (!pickerOpen) return;
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    function onClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setPickerOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pickerOpen]);

  async function toggle(reaction: ReactionKey) {
    if (!canReact || pending) return;
    const active = !visibleViewer.includes(reaction);
    const previousOptimistic = optimistic;
    const nextViewer = policy === "SINGLE"
      ? (active ? [reaction] : [])
      : (active ? [...visibleViewer, reaction] : visibleViewer.filter((key) => key !== reaction));
    const nextCounts: ReactionCounts = { ...visibleCounts };
    if (policy === "SINGLE" && active) {
      for (const current of visibleViewer) {
        nextCounts[current] = Math.max(0, (nextCounts[current] ?? 0) - 1);
      }
    }
    nextCounts[reaction] = Math.max(0, (nextCounts[reaction] ?? 0) + (active ? 1 : -1));
    setOptimistic({
      baseSnapshot: sourceSnapshot,
      counts: nextCounts,
      viewer: nextViewer,
    });
    setPending(reaction);
    setPickerOpen(false);
    try {
      const serverCounts = await onToggle(reaction, active);
      if (serverCounts) {
        setOptimistic((current) => current ? { ...current, counts: serverCounts } : current);
      }
    } catch {
      setOptimistic(previousOptimistic);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={styles.root} aria-label="게시물 반응">
      {activeKeys.map((reaction) => {
        const count = visibleCounts[reaction] ?? 0;
        const selected = visibleViewer.includes(reaction);
        return (
          <button
            className={styles.reaction}
            data-selected={selected}
            type="button"
            key={reaction}
            disabled={!canReact || Boolean(pending)}
            onClick={() => toggle(reaction)}
            aria-pressed={selected}
            aria-label={`${reactionLabel(reaction)} ${count}개`}
          >
            <span className={styles.emoji}>{reactionEmoji(reaction)}</span>
            {count > 0 && <span className={styles.count}>{count}</span>}
            {pending === reaction && <LoaderCircle className="spin" size={11} />}
          </button>
        );
      })}
      <span className={styles.picker}>
        <button
          ref={triggerRef}
          className={styles.add}
          type="button"
          disabled={!canReact || Boolean(pending)}
          onClick={() => setPickerOpen((current) => !current)}
          aria-expanded={pickerOpen}
          aria-label="반응 추가"
          title="반응 추가"
        >
          <SmilePlus size={16} />
        </button>
        {pickerOpen && menuPosition && createPortal(
          <span
            ref={menuRef}
            className={styles.menu}
            role="menu"
            style={{
              position: "fixed",
              top: menuPosition.top,
              left: menuPosition.left,
              bottom: "auto",
              right: "auto",
              transform: menuPosition.openUpward ? "translateY(-100%)" : undefined,
            }}
          >
            {defaultReactionOptions.map((option) => (
              <button
                type="button"
                role="menuitem"
                key={option.key}
                data-selected={visibleViewer.includes(option.key)}
                onClick={() => toggle(option.key)}
                aria-label={option.label}
                title={option.label}
              >
                {option.emoji}
              </button>
            ))}
            {customEmoji.slice(0, 20).map((emoji) => (
              <button type="button" role="menuitem" key={emoji} onClick={() => toggle(`EMOJI:${emoji}`)} aria-label={`${emoji} 반응`}>
                {emoji}
              </button>
            ))}
          </span>,
          document.body,
        )}
      </span>
    </div>
  );
}
