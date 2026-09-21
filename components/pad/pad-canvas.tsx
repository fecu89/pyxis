"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Activity, Archive, ArchiveRestore, Check, ChevronLeft, Download, Globe2, Link2, LoaderCircle, LockKeyhole, Plus, Search, Settings2, Share2, Snowflake, Star, Wifi, WifiOff, X } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Modal } from "@/components/ui/modal";
import { useDialog } from "@/components/ui/app-dialog";
import { PadMoreMenu, type PadMoreMenuItem } from "@/components/pad/pad-more-menu";
import { PadCommentProvider } from "@/components/pad/comments/comment-context";
import { useGuestIdentity } from "@/components/pad/guest-identity";
import { PostCard } from "@/components/pad/post-card";
import { PostCardActionsProvider } from "@/components/pad/post-card-actions";
import { LazyPostComposer, preloadPostComposer } from "@/components/pad/lazy-post-composer";
import { PadLayoutRenderer } from "@/components/pad/layouts/pad-layout-renderer";
import { applyBoardEventDelta, reconcileSectionsPreservingLayout, restorePostDragOrigin, type PostDragOrigin } from "@/components/pad/reconcile-sections";
import { createPostFieldTableColumns } from "@/components/pad/settings/post-field-table-columns";
import type { PadPresentationSettings, PostFieldValues } from "@/components/pad/settings/types";
import type { ParticipationSettings } from "@/components/pad/settings/pad-settings-tabs";
import { usePadEvents } from "@/components/pad/use-pad-events";
import type { PadInitialData, PostData, SectionData } from "@/components/pad/types";
import type { BoardEvent, BoardEventPayload } from "@/lib/realtime/board-events";
import { requestJson } from "@/lib/api-client";
import { APP_NAME } from "@/lib/brand";
import { PAD_HOME_PATH } from "@/lib/route-paths";

// 잘 안 열리는 보관함·활동·공유·내보내기·설정 패널과, SECTIONS 레이아웃(드래그 정렬)
// 전용인 @dnd-kit 기반 보드를 지연 로드로 바꿔 최초 로드 JS를 줄입니다. Turbopack 프로덕션
// 빌드에서는 이 분리가 무시되고 부모 청크로 다시 합쳐지는 걸 확인했지만(debug.md), webpack
// 빌드에서는 실제로 분리됩니다 — 두 빌드 모두에서 손해가 없고 webpack에서는 이득이 있어 유지합니다.
const PadTrash = dynamic(() => import("@/components/pad/pad-trash").then((mod) => mod.PadTrash), { ssr: false });
const PadActivityPanel = dynamic(() => import("@/components/pad/pad-activity-panel").then((mod) => mod.PadActivityPanel), { ssr: false });
const PadSharePanel = dynamic(() => import("@/components/pad/pad-share-panel").then((mod) => mod.PadSharePanel), { ssr: false });
const PadExportPanel = dynamic(() => import("@/components/pad/pad-export-panel").then((mod) => mod.PadExportPanel), { ssr: false });
const PadSettingsTabs = dynamic(() => import("@/components/pad/settings/pad-settings-tabs").then((mod) => mod.PadSettingsTabs), { ssr: false });
const SectionsBoardView = dynamic(() => import("@/components/pad/pad-sections-board").then((mod) => mod.SectionsBoardView), { ssr: false });
const FlatDragBoardView = dynamic(() => import("@/components/pad/pad-flat-board").then((mod) => mod.FlatDragBoardView), { ssr: false });

const discoveryScopeLabel = { PUBLIC: "전체 공개", LINK: "링크 공개", PRIVATE: "비공개" };
const discoveryScopeIcon = { PUBLIC: Globe2, LINK: Link2, PRIVATE: LockKeyhole };

function toLocalDateTimeInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function participationSettings(board: PadInitialData["board"]): ParticipationSettings {
  return {
    allowMemberPosting: board.allowMemberPosting,
    allowMemberFileUpload: board.allowMemberFileUpload,
    allowComments: board.allowComments,
    allowReactions: board.allowReactions,
  };
}

function presentationSettings(board: PadInitialData["board"]): PadPresentationSettings {
  return {
    layout: board.layout,
    sortMode: board.sortMode,
    newPostPlacement: board.newPostPlacement,
    cardSize: board.cardSize,
    font: board.font,
    backgroundColor: board.backgroundColor,
    backgroundImageUrl: board.backgroundImageUrl,
    accentColor: board.accentColor,
    showAuthor: board.showAuthor,
    showTimestamp: board.showTimestamp,
  };
}

const safeBackgroundPathPattern = /^\/api\/boards\/[a-z0-9-]+\/background-image\?v=\d+$/i;

function boardPageStyle(appearance: PadPresentationSettings): CSSProperties {
  return {
    "--board-page-background": appearance.backgroundColor ?? undefined,
    "--board-page-background-image": appearance.backgroundImageUrl && safeBackgroundPathPattern.test(appearance.backgroundImageUrl)
      ? `url("${appearance.backgroundImageUrl}")`
      : undefined,
  } as CSSProperties;
}

function readPostFieldValues(post: PostData): PostFieldValues {
  if (!post.customFieldValues) return {};
  return Object.fromEntries(Object.entries(post.customFieldValues.fields).map(([id, stored]) => [id, stored.value]));
}

export function PadCanvas({
  initialData,
  currentUserId,
  initialFrozen,
  initialNotifications,
}: {
  initialData: PadInitialData;
  currentUserId: string | null;
  initialFrozen: boolean;
  initialNotifications: Parameters<typeof NotificationBell>[0]["initialData"] | null;
}) {
  const [liveData, setLiveData] = useState(initialData);
  const { board, capabilities } = liveData;
  const router = useRouter();
  const dialog = useDialog();
  const guest = useGuestIdentity();
  const [localSections, setLocalSectionsState] = useState<SectionData[] | null>(null);
  const pendingPostMoves = useRef(new Map<string, Promise<void>>());
  const activePostDrag = useRef<string | null>(null);
  const deferredRealtimeSync = useRef(false);
  const knownPostMoveVersions = useRef(new Map<string, number>());
  const protectedPostLayout = useCallback(() => new Set([
    ...pendingPostMoves.current.keys(),
    ...(activePostDrag.current ? [activePostDrag.current] : []),
  ]), []);
  const postPageControllers = useRef(new Map<string, AbortController>());
  const [loadingPostPages, setLoadingPostPages] = useState<Set<string>>(() => new Set());
  const setLocalSections = useCallback((update: SectionData[] | null | ((current: SectionData[] | null) => SectionData[] | null)) => {
    setLocalSectionsState((current) => {
      const reconciled = current
        ? reconcileSectionsPreservingLayout(current, board.sections, board.newPostPlacement)
        : null;
      return typeof update === "function" ? update(reconciled) : update;
    });
  }, [board.newPostPlacement, board.sections]);
  const [query, setQuery] = useState("");
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(board.title);
  const [descriptionDraft, setDescriptionDraft] = useState(board.description ?? "");
  const [appearanceDraft, setAppearanceDraft] = useState<PadPresentationSettings>(() => presentationSettings(board));
  const [fieldConfigDraft, setFieldConfigDraft] = useState(board.postFieldConfig);
  const [participationDraft, setParticipationDraft] = useState<ParticipationSettings>(() => participationSettings(board));
  const [reactionPolicyDraft, setReactionPolicyDraft] = useState(board.reactionPolicy);
  const [downloadPolicyDraft, setDownloadPolicyDraft] = useState(board.attachmentDownloadPolicy);
  const [moderationModeDraft, setModerationModeDraft] = useState(board.moderationMode);
  const [freezeAtDraft, setFreezeAtDraft] = useState(() => toLocalDateTimeInputValue(board.freezeAt));
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextAutosave = useRef(true);
  const [quickSectionId, setQuickSectionId] = useState(board.sections[0]?.id ?? "");
  const [quickComposerOpen, setQuickComposerOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileSectionPickerOpen, setMobileSectionPickerOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // SECTIONS 레이아웃은 SectionColumn이 자기만의 편집 모달을 갖고 있지만, 다른 레이아웃
  // (Wall/Grid/Stream/Timeline/Table)은 섹션 단위 컴포넌트가 없어 여기서 하나만 두고 공유합니다
  // (더블클릭 섹션 편집, 사용자 요청).
  const [editingLayoutSectionId, setEditingLayoutSectionId] = useState<string | null>(null);
  const [layoutSectionError, setLayoutSectionError] = useState("");
  const [favorite, setFavorite] = useState(initialData.isFavorite);
  const [error, setError] = useState("");
  // 예약 동결 여부는 서버가 요청 시각에 계산해 직렬화합니다. Client Component가 Date.now()로
  // 다시 계산하면 SSR과 hydration 사이에 예약 시각이 걸칠 때 DOM이 달라집니다.
  const [scheduledFreezeReached, setScheduledFreezeReached] = useState(initialFrozen && board.state !== "FROZEN");
  const canManage = capabilities.manageBoard;
  const frozen = board.state === "FROZEN" || scheduledFreezeReached;
  const sections = useMemo(() => localSections
    ? reconcileSectionsPreservingLayout(localSections, board.sections, board.newPostPlacement)
    : board.sections, [board.newPostPlacement, board.sections, localSections]);
  const tableColumns = useMemo(() => createPostFieldTableColumns<PostData>(board.postFieldConfig, readPostFieldValues), [board.postFieldConfig]);
  const quickSection = sections.find((section) => section.id === quickSectionId) ?? sections[0];
  const hasUnloadedPosts = sections.some((section) => Boolean(section.nextCursor));
  const canReorderLoadedPosts = !query
    && !hasUnloadedPosts
    && board.sortMode === "MANUAL"
    && (capabilities.editAnyPost || (capabilities.editOwnContent && sections.some((section) => section.posts.some((post) => post.isMine))));

  const realtimeSyncController = useRef<AbortController | null>(null);
  const realtimeSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeEventRevision = useRef(0);
  const deletedPostIds = useRef(new Set<string>());
  const attachmentEventRevisions = useRef(new Map<string, number>());
  const editingAttachmentRevision = useRef(0);
  const retryRealtimeSync = useRef<() => void>(() => {});
  const syncRealtimeSnapshot = useCallback(async () => {
    realtimeSyncController.current?.abort();
    const controller = new AbortController();
    realtimeSyncController.current = controller;
    const revisionAtStart = realtimeEventRevision.current;
    try {
      const result = await requestJson<{ data: PadInitialData }>(`/api/boards/${board.id}/realtime-snapshot`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (controller.signal.aborted) return;
      // 조회가 진행되는 동안 더 최신 SSE가 들어왔다면, 먼저 시작한 스냅샷으로 그 델타를
      // 덮지 않습니다. 잠깐 뒤 다시 읽어 조용해진 시점의 정본만 적용합니다.
      if (realtimeEventRevision.current !== revisionAtStart) {
        retryRealtimeSync.current();
        return;
      }
      // 이동 중 전체 배치를 교체하면 카드를 재마운트합니다. 반대로 로컬 배열을 스냅샷과
      // 합치면 재연결 사이 놓친 다른 카드의 이동/삭제가 유실되므로, 이동이 끝난 뒤 재조회합니다.
      if (protectedPostLayout().size) {
        deferredRealtimeSync.current = true;
        return;
      }
      deferredRealtimeSync.current = false;
      // 재연결 사이 복구돼 현재 스냅샷에 다시 보이는 글은 새로운 삭제 주기를 시작합니다.
      for (const section of result.data.board.sections) {
        for (const post of section.posts) deletedPostIds.current.delete(post.id);
      }
      setLiveData(result.data);
      // 연결이 끊긴 동안 재정렬/삭제 이벤트를 놓쳤을 수 있으므로 이때만 로컬 배치를 정본으로
      // 교체합니다. 평상시 SSE 이벤트는 아래 applyBoardEventDelta가 카드 한 장만 수정합니다.
      setLocalSectionsState(null);
      setFavorite(result.data.isFavorite);
      setScheduledFreezeReached(result.data.initialFrozen && result.data.board.state !== "FROZEN");
      setQuickSectionId((current) => result.data.board.sections.some((section) => section.id === current)
        ? current
        : result.data.board.sections[0]?.id ?? "");
      setError("");
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "패드 최신 상태를 불러오지 못했습니다.");
      }
    } finally {
      if (realtimeSyncController.current === controller) realtimeSyncController.current = null;
    }
  }, [board.id, protectedPostLayout]);
  const requestRealtimeSync = useCallback(() => {
    if (realtimeSyncTimer.current) return;
    // 멤버 변경처럼 이벤트가 연달아 올 때도 탭마다 스냅샷은 한 번만 요청합니다.
    realtimeSyncTimer.current = setTimeout(() => {
      realtimeSyncTimer.current = null;
      void syncRealtimeSnapshot();
    }, 150 + Math.random() * 350);
  }, [syncRealtimeSnapshot]);
  const flushDeferredRealtimeSync = useCallback(() => {
    if (deferredRealtimeSync.current && !protectedPostLayout().size) {
      deferredRealtimeSync.current = false;
      requestRealtimeSync();
    }
  }, [protectedPostLayout, requestRealtimeSync]);
  const handlePostDragChange = useCallback((postId: string | null) => {
    activePostDrag.current = postId;
    if (!postId) flushDeferredRealtimeSync();
  }, [flushDeferredRealtimeSync]);
  useEffect(() => {
    retryRealtimeSync.current = requestRealtimeSync;
  }, [requestRealtimeSync]);
  const applyRealtimeEvent = useCallback((event: BoardEvent) => {
    if (event.type === "post.reordered" && event.payload?.postMove) {
      knownPostMoveVersions.current.set(event.entityId, Math.max(knownPostMoveVersions.current.get(event.entityId) ?? 0, event.payload.postMove.version));
      // 드래그를 취소해도 그 사이 확정된 원격 위치/이전 저장 결과는 나중에 복구해야 합니다.
      if (activePostDrag.current === event.entityId) deferredRealtimeSync.current = true;
    }
    if (event.type.startsWith("attachment.") && event.postId) {
      attachmentEventRevisions.current.set(event.postId, (attachmentEventRevisions.current.get(event.postId) ?? 0) + 1);
    }
    // 삭제 응답과 SSE는 순서가 보장되지 않습니다. 카드 메뉴의 확정 삭제도 같은 경로로
    // 처리하고 한 번만 차감합니다. 복구 API의 post.updated로 다시 나타나면 재삭제를 허용합니다.
    if (event.type === "post.deleted") {
      if (deletedPostIds.current.has(event.entityId)) return;
      deletedPostIds.current.add(event.entityId);
    } else if ((event.type === "post.created" || event.type === "post.updated") && event.payload?.post) {
      deletedPostIds.current.delete(event.entityId);
    }
    realtimeEventRevision.current += 1;
    const resetsLocalLayout = Boolean(event.payload?.boardPatch && (
      event.payload.boardPatch.layout !== undefined
      || event.payload.boardPatch.sortMode !== undefined
      || event.payload.boardPatch.newPostPlacement !== undefined
    ));
    setLiveData((current) => {
      const patchedBoard = event.payload?.boardPatch
        ? { ...current.board, ...event.payload.boardPatch }
        : current.board;
      return {
        ...current,
        board: {
          ...patchedBoard,
          sections: applyBoardEventDelta(
            current.board.sections,
            event,
            patchedBoard.newPostPlacement,
            currentUserId,
          ),
        },
      };
    });
    if (event.payload?.boardPatch?.state === "ACTIVE" && event.payload.boardPatch.freezeAt === null) {
      setScheduledFreezeReached(false);
    }

    // 낙관적 드래그 배열이 실제로 존재할 때만 같은 델타를 그 위에도 적용합니다. 평상시에는
    // liveData.board.sections 하나만 갱신해 카드 트리의 이중 상태를 만들지 않습니다.
    const protectedIds = protectedPostLayout();
    setLocalSectionsState((current) => {
      if (resetsLocalLayout || !current) return null;
      return applyBoardEventDelta(
        current,
        event,
        event.payload?.boardPatch?.newPostPlacement ?? board.newPostPlacement,
        currentUserId,
        protectedIds,
      );
    });

    // 사용자별 권한/멤버 목록은 공용 이벤트 델타만으로 계산할 수 없습니다. 이런 드문 변경과
    // 재연결에만 전용 JSON 스냅샷을 받아 오며 router.refresh()는 호출하지 않습니다.
    if (event.payload?.requiresSync || (event.type === "board.updated" && !event.payload?.boardPatch)) {
      requestRealtimeSync();
    }
  }, [board.newPostPlacement, currentUserId, protectedPostLayout, requestRealtimeSync]);
  const connected = usePadEvents(board.id, applyRealtimeEvent, requestRealtimeSync, guest.guestName);

  const savePostMove = useCallback((postId: string, move: {
    targetSectionId: string;
    previousItemId: string | null;
    nextItemId: string | null;
  }, origin: PostDragOrigin | null) => {
    const previous = pendingPostMoves.current.get(postId);
    // 같은 카드만 직렬화합니다. 다른 카드의 저장이나 화면 드래그는 기다리지 않습니다.
    const operation: Promise<void> = (previous ?? Promise.resolve()).then(async () => {
      try {
        const result = await requestJson<{ postMove: NonNullable<BoardEventPayload["postMove"]> }>(`/api/posts/${postId}/reorder`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(move),
        });
        const event: BoardEvent = { type: "post.reordered", entityId: postId, sectionId: result.postMove.sectionId, payload: { postMove: result.postMove } };
        if (result.postMove.version < (knownPostMoveVersions.current.get(postId) ?? 0)) deferredRealtimeSync.current = true;
        if (pendingPostMoves.current.get(postId) === operation) pendingPostMoves.current.delete(postId);
        applyRealtimeEvent(event);
        flushDeferredRealtimeSync();
      } catch (reason) {
        // 이전 요청의 실패/완료가 다음 이동이나 새 드래그의 취소 원점을 지우면 안 됩니다.
        if (pendingPostMoves.current.get(postId) !== operation) return;
        pendingPostMoves.current.delete(postId);
        if (origin && activePostDrag.current !== postId) {
          setLocalSectionsState((current) => current ? restorePostDragOrigin(current, origin) : current);
        }
        setError(reason instanceof Error ? reason.message : "순서를 바꾸지 못했습니다.");
        deferredRealtimeSync.current = true;
        flushDeferredRealtimeSync();
      }
    });
    pendingPostMoves.current.set(postId, operation);
  }, [applyRealtimeEvent, flushDeferredRealtimeSync]);

  const handleCardPostDeleted = useCallback((postId: string, sectionId: string) => {
    // 추가 페이지에만 있는 카드도 기본 스냅샷의 섹션 총수에서 한 번 차감합니다.
    applyRealtimeEvent({ type: "post.deleted", entityId: postId, sectionId });
  }, [applyRealtimeEvent]);

  const handleCardEditStarted = useCallback((postId: string) => {
    editingAttachmentRevision.current = attachmentEventRevisions.current.get(postId) ?? 0;
  }, []);

  const handleCardPostSaved = useCallback((post: PostData) => {
    // 전체 스냅샷으로 바꾸면 더 불러온 페이지·드래그 위치가 사라집니다. 해당 카드만 갱신하되
    // 댓글·반응의 동시 변경은 기존 SSE 병합 규칙으로 보존하고 첨부는 저장 응답을 반영합니다.
    // 첨부 변경은 post.version을 올리지 않습니다. 편집 중 첨부 SSE를 받았다면 그 델타를
    // 우선해, 뒤늦은 저장 응답으로 동시에 추가/삭제된 첨부를 되돌리지 않습니다.
    const preserveAttachments = (attachmentEventRevisions.current.get(post.id) ?? 0) !== editingAttachmentRevision.current;
    const update = (current: SectionData[]) => current.map((section) => {
      const existing = section.posts.find((item) => item.id === post.id);
      if (!existing || existing.version > post.version) return section;
      const [updated] = applyBoardEventDelta([section], {
        type: "post.updated", entityId: post.id, sectionId: section.id,
        payload: { post, layoutChanged: existing.isPinned !== post.isPinned },
      }, board.newPostPlacement, currentUserId);
      return preserveAttachments ? updated : { ...updated, posts: updated.posts.map((item) => item.id === post.id ? { ...item, attachments: post.attachments } : item) };
    });
    realtimeEventRevision.current += 1;
    setLiveData((current) => ({ ...current, board: { ...current.board, sections: update(current.board.sections) } }));
    setLocalSectionsState((current) => current ? update(current) : null);
  }, [board.newPostPlacement, currentUserId]);

  const loadMorePosts = useCallback(async (sectionId: string) => {
    const target = sections.find((section) => section.id === sectionId);
    const cursor = target?.nextCursor;
    if (!cursor || postPageControllers.current.has(sectionId)) return;
    const controller = new AbortController();
    postPageControllers.current.set(sectionId, controller);
    setLoadingPostPages((current) => new Set(current).add(sectionId));
    try {
      const result = await requestJson<{ posts: PostData[]; nextCursor: string | null }>(`/api/sections/${sectionId}/posts?cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal });
      // 복구 SSE를 놓친 뒤 두 번째 이후 페이지에서 다시 만난 글도 삭제할 수 있게 합니다.
      for (const post of result.posts) deletedPostIds.current.delete(post.id);
      setLocalSections((current) => (current ?? board.sections).map((section) => {
        // 그 사이 재정렬/새로고침으로 페이지 기준점이 달라졌으면 오래된 응답을 붙이지 않습니다.
        if (section.id !== sectionId || section.nextCursor !== cursor) return section;
        const known = new Set(section.posts.map((post) => post.id));
        return {
          ...section,
          posts: [...section.posts, ...result.posts.filter((post) => !known.has(post.id))],
          nextCursor: result.nextCursor,
        };
      }));
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "게시물을 더 불러오지 못했습니다.");
    } finally {
      if (postPageControllers.current.get(sectionId) === controller) {
        postPageControllers.current.delete(sectionId);
        setLoadingPostPages((current) => {
          const next = new Set(current);
          next.delete(sectionId);
          return next;
        });
      }
    }
  }, [board.sections, sections, setLocalSections]);

  useEffect(() => () => {
    for (const controller of postPageControllers.current.values()) controller.abort();
    postPageControllers.current.clear();
    realtimeSyncController.current?.abort();
    realtimeSyncController.current = null;
    if (realtimeSyncTimer.current) clearTimeout(realtimeSyncTimer.current);
    realtimeSyncTimer.current = null;
  }, []);

  // 상위 라우트가 명시적인 탐색 등으로 새 props를 준 경우에도 같은 클라이언트 인스턴스가
  // 오래된 스냅샷을 붙잡지 않게 합니다. 실시간 변경 자체는 liveData에 직접 반영됩니다.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setLiveData(initialData);
      setFavorite(initialData.isFavorite);
      setScheduledFreezeReached(initialData.initialFrozen && initialData.board.state !== "FROZEN");
    });
    return () => cancelAnimationFrame(frame);
  }, [initialData]);

  useEffect(() => {
    if (frozen || !board.freezeAt) return;
    const freezeAtMs = new Date(board.freezeAt).getTime();
    if (!Number.isFinite(freezeAtMs)) return;
    let timer: number | undefined;
    const schedule = () => {
      const remainingMs = freezeAtMs - Date.now();
      if (remainingMs <= 0) {
        setScheduledFreezeReached(true);
        return;
      }
      timer = window.setTimeout(schedule, Math.min(remainingMs, 2_147_483_647));
    };
    schedule();
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [board.freezeAt, frozen]);

  // 자주 안 쓰는 보드 상단 아이콘(활동·즐겨찾기·보관함·내보내기)을 "더보기" 메뉴 하나로
  // 모아, 상단바가 아이콘으로 가득 차는 문제(특히 모바일)를 줄입니다. 알림 벨(개인 알림)과
  // 별도 모델인 활동 팔로우를 별표로 표시하면 홈의 즐겨찾기와 같은 기능처럼 보이므로, 이 별표는
  // 실제 즐겨찾기 API에 연결합니다. 활동 내역은 바로 위 메뉴에서 계속 확인할 수 있습니다.
  const moreMenuItems = useMemo<PadMoreMenuItem[]>(() => {
    const items: PadMoreMenuItem[] = [];
    if (currentUserId) items.push({ key: "activity", label: "패드 활동 기록", icon: <Activity size={16} />, onClick: () => setActivityOpen(true) });
    if (currentUserId) items.push({ key: "favorite", label: favorite ? "즐겨찾기 해제" : "즐겨찾기 추가", icon: <Star size={16} fill={favorite ? "currentColor" : "none"} />, onClick: toggleFavorite });
    if (canManage) items.push({ key: "add-section", label: "새 섹션 만들기", icon: <Plus size={16} />, onClick: () => setAddSectionOpen(true) });
    if (capabilities.viewTrash) items.push({ key: "trash", label: "삭제한 항목", icon: <ArchiveRestore size={16} />, onClick: () => setTrashOpen(true) });
    items.push({ key: "export", label: "내보내기·발표", icon: <Download size={16} />, onClick: () => setExportOpen(true) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, favorite, canManage, capabilities.viewTrash]);

  async function toggleFavorite() {
    const previous = favorite;
    const next = !previous;
    setFavorite(next);
    const response = await fetch(`/api/boards/${board.id}/favorite`, { method: next ? "PUT" : "DELETE" });
    if (!response.ok) {
      setFavorite(previous);
      setError("즐겨찾기를 변경하지 못했습니다.");
    }
  }

  // 검색은 현재 내려받은 페이지 안에서 즉시 끝냅니다. 아직 뒷페이지가 남아 있으면 화면에
  // 범위를 안내하고, 더 보기를 누른 만큼 검색 범위도 자연스럽게 넓어집니다.
  const filteredSections = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return sections;
    return sections
      .map((section) => {
        const posts = section.posts.filter((post) => `${post.title ?? ""}\n${post.body}`.toLocaleLowerCase().includes(term));
        return { ...section, posts, totalPostCount: posts.length, nextCursor: null };
      })
      .filter((section) => section.posts.length > 0);
  }, [query, sections]);

  function closeMobileSearch() {
    setMobileSearchOpen(false);
    setQuery("");
  }

  // 손님이면 작성창을 열기 전에 이름을 한 번 묻습니다. 작성창을 여는 길이 여러 갈래(플로팅
  // 글 추가 버튼·섹션 선택 팝업)라 여기 한곳으로 모읍니다.
  async function openQuickComposer() {
    if (!(await guest.ensureName())) return;
    setQuickComposerOpen(true);
  }

  function openMobilePostComposer() {
    setMobileSearchOpen(false);
    setQuery("");
    if (board.layout !== "SECTIONS" && sections.length > 1) {
      setMobileSectionPickerOpen((open) => !open);
      return;
    }
    setMobileSectionPickerOpen(false);
    void openQuickComposer();
  }

  async function chooseMobileSection(sectionId: string) {
    setQuickSectionId(sectionId);
    setMobileSectionPickerOpen(false);
    await openQuickComposer();
  }

  async function addSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/boards/${board.id}/sections`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: data.get("title"), description: data.get("description") }) });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "섹션을 추가하지 못했습니다.");
    }
    setAddSectionOpen(false);
  }

  const editingLayoutSection = sections.find((section) => section.id === editingLayoutSectionId) ?? null;

  async function saveLayoutSection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingLayoutSectionId) return;
    setLayoutSectionError("");
    const data = new FormData(event.currentTarget);
    try {
      await requestJson(`/api/sections/${editingLayoutSectionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: data.get("title"), description: data.get("description") }) });
    } catch (reason) {
      return setLayoutSectionError(reason instanceof Error ? reason.message : "섹션을 수정하지 못했습니다.");
    }
    setEditingLayoutSectionId(null);
  }

  function openSettings() {
    setTitleDraft(board.title);
    setDescriptionDraft(board.description ?? "");
    setAppearanceDraft(presentationSettings(board));
    setFieldConfigDraft(board.postFieldConfig);
    setParticipationDraft(participationSettings(board));
    setReactionPolicyDraft(board.reactionPolicy);
    setDownloadPolicyDraft(board.attachmentDownloadPolicy);
    setModerationModeDraft(board.moderationMode);
    setFreezeAtDraft(toLocalDateTimeInputValue(board.freezeAt));
    setSaveStatus("idle");
    // 모달을 여는 이 초기화 자체가 draft state를 바꾸므로, 바로 아래 자동저장 effect가 "값이
    // 바뀌었다"고 착각해 열자마자 저장을 쏘지 않도록 다음 한 번의 변경 감지는 건너뜁니다.
    skipNextAutosave.current = true;
    setSettingsOpen(true);
  }

  // 발견 범위·방문자 권한·로그인 필수·비밀번호는 여전히 공유 패널이 전담하므로 여기서는 절대
  // 보내지 않습니다 — updateBoardSchema는 생략된 필드를 그대로 두는 부분 PATCH라 안 보내는 한
  // 값이 안전합니다.
  const saveBoardSettingsNow = useCallback(async () => {
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current);
    setSaveStatus("saving");
    try {
      await requestJson(`/api/boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleDraft,
          description: descriptionDraft,
          layout: appearanceDraft.layout,
          sortMode: appearanceDraft.sortMode,
          newPostPlacement: appearanceDraft.newPostPlacement,
          cardSize: appearanceDraft.cardSize,
          font: appearanceDraft.font,
          backgroundColor: appearanceDraft.backgroundColor,
          accentColor: appearanceDraft.accentColor,
          showAuthor: appearanceDraft.showAuthor,
          showTimestamp: appearanceDraft.showTimestamp,
          postFieldConfig: fieldConfigDraft,
          reactionPolicy: reactionPolicyDraft,
          attachmentDownloadPolicy: downloadPolicyDraft,
          ...participationDraft,
          moderationMode: moderationModeDraft,
          freezeAt: freezeAtDraft ? new Date(freezeAtDraft).toISOString() : null,
        }),
      });
      setSaveStatus("saved");
      // 정렬 규칙이 바뀌면 이전 수동 드래그 배열은 버립니다. 나머지 보드 필드는 자기 요청까지
      // 포함해 board.updated 델타가 반영하므로 Server Component 전체를 다시 실행하지 않습니다.
      if (
        appearanceDraft.layout !== board.layout
        || appearanceDraft.sortMode !== board.sortMode
        || appearanceDraft.newPostPlacement !== board.newPostPlacement
      ) setLocalSections(null);
    } catch (reason) {
      setSaveStatus("error");
      setError(reason instanceof Error ? reason.message : "설정을 저장하지 못했습니다.");
    }
  }, [board.id, board.layout, board.newPostPlacement, board.sortMode, titleDraft, descriptionDraft, appearanceDraft, fieldConfigDraft, participationDraft, reactionPolicyDraft, downloadPolicyDraft, moderationModeDraft, freezeAtDraft, setLocalSections]);

  const changeBackgroundImage = useCallback((backgroundImageUrl: string | null) => {
    setAppearanceDraft((current) => ({ ...current, backgroundImageUrl }));
    setSaveStatus("saved");
  }, []);

  // 예전에는 탭을 다 고치고 "설정 저장" 버튼을 눌러야 반영됐는데, 그게 불편하다는 피드백을 받아
  // 대부분의 설정은 바뀔 때마다(디바운스) 자동으로 저장합니다. 다만 "게시물 필드"(질문 라벨·
  // 선택지 같은 텍스트를 계속 다듬는 탭)는 한 글자 바꿀 때마다 저장되면 작성 중인 내용이 자꾸
  // 반영되어 불편하다는 피드백을 받아 fieldConfigDraft는 이 자동저장 대상에서 뺐습니다 — 그
  // 탭에는 명시적 "필드 설정 저장" 버튼(onApplyFieldConfig)을 따로 둡니다.
  useEffect(() => {
    if (!settingsOpen) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current);
    setSaveStatus("saving");
    settingsSaveTimer.current = setTimeout(() => { void saveBoardSettingsNow(); }, 500);
    return () => {
      if (settingsSaveTimer.current) clearTimeout(settingsSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    titleDraft,
    descriptionDraft,
    appearanceDraft.layout,
    appearanceDraft.sortMode,
    appearanceDraft.newPostPlacement,
    appearanceDraft.cardSize,
    appearanceDraft.font,
    appearanceDraft.backgroundColor,
    appearanceDraft.accentColor,
    appearanceDraft.showAuthor,
    appearanceDraft.showTimestamp,
    participationDraft,
    reactionPolicyDraft,
    downloadPolicyDraft,
    moderationModeDraft,
    freezeAtDraft,
  ]);

  async function inviteMember() {
    // 기본값에 실제 사용자 아이디가 박혀 있어서, 남의 아이디가 남의 화면에 초깃값으로 떴습니다.
    // 네이티브 prompt도 앱의 나머지 모달과 생김새가 따로 놀아 함께 걷어냅니다.
    const loginIdentifier = (await dialog.promptText({
      title: "멤버 초대",
      label: `${APP_NAME} 아이디 또는 카카오 이메일`,
      placeholder: "예: hong2024 또는 hong@example.com",
      maxLength: 254,
      validate: (value) => (value ? null : "아이디 또는 이메일을 입력해 주세요."),
    }))?.trim();
    if (!loginIdentifier) return;
    try {
      const identityField = loginIdentifier.includes("@")
        ? { email: loginIdentifier }
        : { loginId: loginIdentifier };
      await requestJson(`/api/boards/${board.id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...identityField, role: "MEMBER" }) });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "멤버를 초대하지 못했습니다.");
    }
  }

  async function changeMemberRole(userId: string, role: string) {
    try {
      await requestJson(`/api/boards/${board.id}/members/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "역할을 바꾸지 못했습니다.");
    }
  }

  async function removeMember(userId: string) {
    if (!(await dialog.confirm("이 멤버를 패드에서 내보낼까요?"))) return;
    try {
      await requestJson(`/api/boards/${board.id}/members/${userId}`, { method: "DELETE" });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "멤버를 내보내지 못했습니다.");
    }
  }

  async function toggleFreeze() {
    const next = frozen ? "ACTIVE" : "FROZEN";
    if (next === "FROZEN" && !(await dialog.confirm("패드를 동결할까요? 동결 중에는 새 게시물·댓글·이동이 모두 막혀요."))) return;
    // 해제할 때는 지나간 예약 시각도 함께 지워야, 예약이 남아 있어 즉시 다시 동결 상태로 판정되는 걸 막을 수 있습니다.
    const body = next === "ACTIVE" ? { state: next, freezeAt: null } : { state: next };
    try {
      await requestJson(`/api/boards/${board.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "동결 상태를 바꾸지 못했습니다.");
    }
  }

  async function archiveBoard() {
    if (!(await dialog.confirm(`'${board.title}' 패드를 보관할까요? 7일 동안 홈에서 복구할 수 있습니다.`))) return;
    try {
      await requestJson(`/api/boards/${board.id}`, { method: "DELETE" });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "패드를 보관하지 못했습니다.");
    }
    setSettingsOpen(false);
    router.push(PAD_HOME_PATH);
  }


  return (
    <PadCommentProvider board={board} currentUserId={currentUserId}>
    <PostCardActionsProvider sections={sections} capabilities={capabilities} frozen={frozen} fieldConfig={board.postFieldConfig} onEditStarted={handleCardEditStarted} onSaved={handleCardPostSaved} onDeleted={handleCardPostDeleted} onError={setError}>
    <main className="board-page" style={boardPageStyle(settingsOpen ? appearanceDraft : presentationSettings(board))}>
      <header className="board-nav">
        <Link href={currentUserId ? PAD_HOME_PATH : "/"} className="back-link"><ChevronLeft size={18} /><Logo size={22} /><b>{APP_NAME}</b></Link>
        {/* 예전에는 상단바 아래 board-hero가 큰 제목·공개 범위 라벨·멤버 수를 한 줄 더 차지했는데,
            글 내용이 아닌 영역이 너무 높다는 피드백(padlet 대비 2배)으로 상단바 가운데 한 곳에
            합쳤습니다. 공개 범위는 아이콘만 두고 라벨은 툴팁으로, 제목이 길면 줄이지 않고 이
            영역 안에서만 가로 스크롤합니다. */}
        <div className="board-nav-center" title={board.description ?? undefined}>
          {(() => { const ScopeIcon = discoveryScopeIcon[board.discoveryScope]; return <span className="board-nav-scope" title={discoveryScopeLabel[board.discoveryScope]} aria-label={discoveryScopeLabel[board.discoveryScope]}><ScopeIcon size={14} /></span>; })()}
          <span className="board-nav-title" onDoubleClick={() => canManage && openSettings()} title={canManage ? "더블클릭하면 패드 설정에서 제목을 바꿀 수 있어요" : undefined}>{board.title}</span>
          <span className="board-nav-owner">{board.owner.name || APP_NAME}</span>
        </div>
        <div className="board-nav-actions">
          <span className={`sync-state ${connected ? "online" : ""}`} title={connected ? "실시간 연결됨" : "연결 중"} aria-label={connected ? "실시간 연결됨" : "연결 중"}>{connected ? <Wifi size={15} /> : <WifiOff size={15} />}</span>
          <ThemeToggle />
          {currentUserId && initialNotifications ? <NotificationBell initialData={initialNotifications} /> : null}
          <div className="board-toolbar-group">
            <button className="board-toolbar-item" onClick={() => setShareOpen(true)} aria-label="패드 공유"><Share2 size={16} /><span className="board-toolbar-label">공유</span></button>
            <PadMoreMenu items={moreMenuItems} className="board-toolbar-item board-toolbar-more" rootClassName="board-toolbar-more-wrap" />
            {canManage && <button className="board-toolbar-item" onClick={openSettings} aria-label="패드 설정"><Settings2 size={18} /></button>}
          </div>
        </div>
      </header>

      {frozen && <div className="board-frozen-banner"><Snowflake size={16} />이 패드는 동결되어 있어요. 새 게시물·댓글·이동이 모두 막혀 있습니다.{canManage && <button type="button" onClick={toggleFreeze}>동결 해제</button>}</div>}

      {error && <p className="board-error">{error}</p>}
      {query && hasUnloadedPosts && <p className="mx-4 mt-3 rounded-xl bg-warning-soft px-4 py-2 text-xs font-bold text-warning-soft-fg sm:mx-6">현재 불러온 글에서 검색 중입니다. 이전 글은 검색을 닫고 해당 섹션의 더 보기를 눌러 불러올 수 있어요.</p>}

      {board.layout === "SECTIONS" ? (
        <SectionsBoardView
          boardId={board.id}
          sortMode={board.sortMode}
          baseSections={board.sections}
          sections={sections}
          filteredSections={filteredSections}
          query={query}
          canManage={canManage}
          capabilities={capabilities}
          currentUserId={currentUserId}
          fieldConfig={board.postFieldConfig}
          reactionPolicy={board.reactionPolicy}
          showAuthor={board.showAuthor}
          showTimestamp={board.showTimestamp}
          accentColor={board.accentColor}
          setLocalSections={setLocalSections}
          onPostDragChange={handlePostDragChange}
          onPostMove={savePostMove}
          setError={setError}
          onAddSection={() => setAddSectionOpen(true)}
          onActiveSectionChange={setQuickSectionId}
          onLoadMore={query ? undefined : loadMorePosts}
          loadingPostPages={loadingPostPages}
        />
      ) : (board.layout === "WALL" || board.layout === "GRID") && canReorderLoadedPosts ? (
        <FlatDragBoardView
          boardId={board.id}
          layout={board.layout}
          sortMode={board.sortMode}
          newPostPlacement={board.newPostPlacement}
          sections={sections}
          filteredSections={filteredSections}
          query={query}
          capabilities={capabilities}
          reactionPolicy={board.reactionPolicy}
          appearance={{
            backgroundColor: null,
            backgroundImageUrl: null,
            accentColor: board.accentColor,
            cardSize: board.cardSize,
            font: board.font,
            showAuthor: board.showAuthor,
            showTimestamp: board.showTimestamp,
          }}
          onEditSection={canManage ? (section) => setEditingLayoutSectionId(section.id) : undefined}
          setLocalSections={setLocalSections}
          setError={setError}
          paginationIncomplete={hasUnloadedPosts}
        />
      ) : (
        <PadLayoutRenderer
          layout={board.layout}
          sections={filteredSections}
          sortMode={board.sortMode}
          newPostPlacement={board.newPostPlacement}
          appearance={{
            backgroundColor: null,
            backgroundImageUrl: null,
            accentColor: board.accentColor,
            cardSize: board.cardSize,
            font: board.font,
            showAuthor: board.showAuthor,
            showTimestamp: board.showTimestamp,
          }}
          tableColumns={tableColumns}
          onEditSection={canManage ? (section) => setEditingLayoutSectionId(section.id) : undefined}
          renderPost={(post, context) => (
            <PostCard
              key={post.id}
              post={post}
              sectionId={context.section.id}
              reactionPolicy={board.reactionPolicy}
              capabilities={capabilities}
              showAuthor={board.showAuthor}
              showTimestamp={board.showTimestamp}
              // 표 레이아웃은 카드가 한 칸(td)에 들어가고 옆으로 다른 열이 이어집니다.
              // 그 안에 입력창을 넣으면 행이 통째로 흔들려서 여기서만 뺍니다.
              showComments={board.layout !== "TABLE"}
            />
          )}
        />
      )}

      {board.layout !== "SECTIONS" && !query && hasUnloadedPosts ? (
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2 px-4 pb-5 pt-2" aria-label="게시물 더 불러오기">
          {sections.filter((section) => section.nextCursor).map((section) => (
            <button key={section.id} type="button" disabled={loadingPostPages.has(section.id)} onClick={() => void loadMorePosts(section.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-xs font-black text-content-muted shadow-sm disabled:opacity-50">
              {loadingPostPages.has(section.id) ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}{section.title} 더 보기
            </button>
          ))}
        </div>
      ) : null}

      {quickSection && quickComposerOpen && <LazyPostComposer open={quickComposerOpen} onClose={() => setQuickComposerOpen(false)} sectionId={quickSection.id} sectionTitle={quickSection.title} fieldConfig={board.postFieldConfig} />}

      {/* 검색·글 추가는 화면 크기와 관계없이 오른쪽 아래 플로팅 버튼 하나씩입니다 — 상단의
          검색·안내·섹션 추가 도구 줄(.board-tools)과 데스크톱 전용 글 추가 버튼은 상단 영역을
          줄이는 개편에서 제거했습니다(섹션 추가는 "더보기" 메뉴에 그대로 있습니다). */}
      <div className="board-mobile-controls">
        {mobileSearchOpen && (
          <div className="board-mobile-search" id="board-mobile-search" role="search">
            <Search size={15} aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") closeMobileSearch(); }}
              placeholder="불러온 글에서 검색"
              aria-label="패드에서 검색"
              autoFocus
            />
            <button type="button" onClick={closeMobileSearch} aria-label="검색 닫기"><X size={15} /></button>
          </div>
        )}
        {mobileSectionPickerOpen && (
          <div className="board-mobile-section-picker" id="board-mobile-section-picker" role="dialog" aria-label="글을 추가할 섹션">
            <header><b>어디에 추가할까요?</b><button type="button" onClick={() => setMobileSectionPickerOpen(false)} aria-label="섹션 선택 닫기"><X size={14} /></button></header>
            {sections.map((section) => <button type="button" key={section.id} onClick={() => chooseMobileSection(section.id)}>{section.title}</button>)}
          </div>
        )}
        <div className="board-mobile-actions">
          <button
            type="button"
            className="board-mobile-action search"
            data-active={mobileSearchOpen || Boolean(query)}
            aria-label={mobileSearchOpen ? "검색 닫기" : "패드에서 검색"}
            aria-expanded={mobileSearchOpen}
            aria-controls="board-mobile-search"
            onClick={() => {
              setMobileSectionPickerOpen(false);
              if (mobileSearchOpen) closeMobileSearch();
              else setMobileSearchOpen(true);
            }}
          >
            <Search size={17} />
          </button>
          {quickSection && capabilities.createPost && (
            <button type="button" className="board-mobile-action add" aria-label={`${quickSection.title}에 새 글 추가`} aria-expanded={mobileSectionPickerOpen} aria-controls={board.layout !== "SECTIONS" && sections.length > 1 ? "board-mobile-section-picker" : undefined} onPointerEnter={preloadPostComposer} onFocus={preloadPostComposer} onClick={openMobilePostComposer}><Plus size={18} /></button>
          )}
        </div>
      </div>

      <Modal open={addSectionOpen} onClose={() => setAddSectionOpen(false)} title="새 섹션 열기" description="생각을 모을 새로운 주제를 정해요."><form className="stack-form" onSubmit={addSection}><label>섹션 제목<input name="title" placeholder="예: 우리가 찾은 자료" required maxLength={80} autoFocus /></label><label>안내 문구<textarea name="description" placeholder="어떤 내용을 나누는 곳인지 알려주세요." rows={3} maxLength={240} /></label>{error && <p className="form-error">{error}</p>}<button className="button primary full">섹션 추가</button></form></Modal>

      <Modal open={editingLayoutSection !== null} onClose={() => setEditingLayoutSectionId(null)} title="섹션 다듬기" description="제목과 안내 문구를 바꿀 수 있어요.">
        {editingLayoutSection && <form key={editingLayoutSection.id} className="stack-form" onSubmit={saveLayoutSection}><label>섹션 제목<input name="title" defaultValue={editingLayoutSection.title} required maxLength={80} autoFocus /></label><label>안내 문구<textarea name="description" defaultValue={editingLayoutSection.description ?? ""} rows={3} maxLength={240} /></label>{layoutSectionError && <p className="form-error">{layoutSectionError}</p>}<button className="button primary full">변경 내용 저장</button></form>}
      </Modal>

      <Modal open={trashOpen} onClose={() => setTrashOpen(false)} title="삭제한 항목" description="이 패드에서 삭제한 섹션·글·댓글은 7일 동안 여기서 복구할 수 있어요. 첨부파일은 즉시 영구 삭제됩니다." className="trash-modal">{trashOpen && <PadTrash boardId={board.id} open={trashOpen} />}</Modal>

      <Modal open={activityOpen} onClose={() => setActivityOpen(false)} title="패드 활동" description="이 패드에서 있었던 일들을 시간순으로 볼 수 있어요.">{activityOpen && <PadActivityPanel boardId={board.id} open={activityOpen} />}</Modal>

      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title="패드 공유" description="링크나 QR 코드로 빠르게 전달하세요.">{shareOpen && <PadSharePanel board={board} canManage={canManage} />}</Modal>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="내보내기·발표" description="인쇄·발표 화면을 열거나, 게시물·댓글·반응·첨부파일을 파일로 받아요." className="export-modal">{exportOpen && <PadExportPanel board={board} canManage={canManage} />}</Modal>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="패드 설정" description="기능별로 묶은 탭에서 원하는 설정을 찾아 바꿔보세요." className="settings-modal" variant="side">
        <div className="settings-shell">
          {settingsOpen && (
            <PadSettingsTabs
              board={board}
              isOwner={liveData.currentRole === "OWNER"}
              frozen={frozen}
              titleDraft={titleDraft}
              onTitleChange={setTitleDraft}
              descriptionDraft={descriptionDraft}
              onDescriptionChange={setDescriptionDraft}
              appearanceDraft={appearanceDraft}
              onAppearanceChange={setAppearanceDraft}
              onBackgroundImageChange={changeBackgroundImage}
              fieldConfigDraft={fieldConfigDraft}
              onFieldConfigChange={setFieldConfigDraft}
              onApplyFieldConfig={() => { void saveBoardSettingsNow(); }}
              participationDraft={participationDraft}
              onParticipationChange={setParticipationDraft}
              reactionPolicyDraft={reactionPolicyDraft}
              onReactionPolicyChange={setReactionPolicyDraft}
              downloadPolicyDraft={downloadPolicyDraft}
              onDownloadPolicyChange={setDownloadPolicyDraft}
              moderationModeDraft={moderationModeDraft}
              onModerationModeChange={setModerationModeDraft}
              freezeAtDraft={freezeAtDraft}
              onFreezeAtChange={setFreezeAtDraft}
              onToggleFreeze={toggleFreeze}
              onInviteMember={inviteMember}
              onChangeMemberRole={changeMemberRole}
              onRemoveMember={removeMember}
            />
          )}
          <footer className="settings-footer">
            <div>
              {error && <p className="form-error compact">{error}</p>}
              <div className="settings-save-status" data-status={saveStatus}>
                {saveStatus === "saving" && <><LoaderCircle size={14} className="spin" />저장하는 중…</>}
                {saveStatus === "saved" && <><Check size={14} />모든 변경 사항이 저장됐어요</>}
                {saveStatus === "error" && <>저장하지 못했어요. 다시 시도해 주세요.</>}
                {saveStatus === "idle" && <>저장 버튼이 없는 항목은 자동으로 저장됩니다.</>}
              </div>
            </div>
            {capabilities.archiveBoard && <button type="button" className="button danger settings-archive-button" onClick={archiveBoard}><Archive size={15} />패드 보관</button>}
          </footer>
        </div>
      </Modal>
    </main>
    </PostCardActionsProvider>
    </PadCommentProvider>
  );
}
