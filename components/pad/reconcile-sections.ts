import type { PostData, SectionData } from "@/components/pad/types";
import type { BoardEvent } from "@/lib/realtime/board-events";
import { mergeAttachmentImage, preserveImageRevisions } from "@/lib/files/attachment-url";

const CARD_COMMENT_LIMIT = 20;

export type PostDragOrigin = {
  postId: string;
  sectionId: string;
  index: number;
  previousItemId: string | null;
  nextItemId: string | null;
};

/**
 * 취소되거나 저장하지 못한 섹션 간 드래그를 되돌립니다. 드래그 시작 당시 배열 전체를 덮어쓰지
 * 않고 카드 한 장만 원래 이웃 사이로 돌려놓으므로, 드래그 중 SSE로 들어온 새 글/수정은 남습니다.
 */
export function restorePostDragOrigin(current: SectionData[], origin: PostDragOrigin): SectionData[] {
  const source = current.find((section) => section.id === origin.sectionId);
  const currentSection = current.find((section) => section.posts.some((post) => post.id === origin.postId));
  const moving = currentSection?.posts.find((post) => post.id === origin.postId);
  if (!source || !currentSection || !moving) return current;

  const next = current.map((section) => ({ ...section, posts: section.posts.filter((post) => post.id !== origin.postId) }));
  const target = next.find((section) => section.id === origin.sectionId);
  if (!target) return current;

  const previousIndex = origin.previousItemId
    ? target.posts.findIndex((post) => post.id === origin.previousItemId)
    : -1;
  const nextIndex = origin.nextItemId
    ? target.posts.findIndex((post) => post.id === origin.nextItemId)
    : -1;
  const insertionIndex = previousIndex >= 0
    ? previousIndex + 1
    : nextIndex >= 0
      ? nextIndex
      : Math.min(origin.index, target.posts.length);
  target.posts.splice(insertionIndex, 0, moving);

  // totalPostCount는 아직 내려받지 않은 페이지까지 포함합니다. 현재 DOM 배열 길이로 덮으면
  // 페이지를 나눈 보드에서 실제 총 글 수가 30개로 줄어 보입니다. 다만 섹션을 건넌 카드 한
  // 장의 증감은 확실하므로 원본·대상 카운터에도 같은 델타를 적용합니다.
  if (currentSection.id !== target.id) {
    target.totalPostCount += 1;
    const previousTarget = next.find((section) => section.id === currentSection.id);
    if (previousTarget) previousTarget.totalPostCount = Math.max(0, previousTarget.totalPostCount - 1);
  }
  return next;
}

function mergeNewPosts(
  currentPosts: PostData[],
  added: PostData[],
  placement: "START" | "END",
) {
  if (!added.length) return currentPosts;

  const existingPinned = currentPosts.filter((post) => post.isPinned);
  const existingRegular = currentPosts.filter((post) => !post.isPinned);
  const addedPinned = added.filter((post) => post.isPinned);
  const addedRegular = added.filter((post) => !post.isPinned);

  return placement === "START"
    ? [...addedPinned, ...existingPinned, ...addedRegular, ...existingRegular]
    : [...existingPinned, ...addedPinned, ...existingRegular, ...addedRegular];
}

function insertPostByPosition(
  posts: PostData[],
  incoming: PostData,
  placement: "START" | "END",
) {
  const next = [...posts];
  const groupStart = incoming.isPinned ? 0 : Math.max(0, next.findIndex((post) => !post.isPinned));
  const normalizedStart = !incoming.isPinned && groupStart === 0 && next.every((post) => post.isPinned)
    ? next.length
    : groupStart;
  let insertionIndex = next.length;
  for (let index = normalizedStart; index < next.length; index += 1) {
    const candidate = next[index];
    if (candidate.isPinned !== incoming.isPinned) {
      insertionIndex = index;
      break;
    }
    if (
      candidate.position > incoming.position
      || (candidate.position === incoming.position && candidate.id.localeCompare(incoming.id) > 0)
    ) {
      insertionIndex = index;
      break;
    }
  }
  // 과거 데이터의 position이 비정상이어도 새 글 정책에 맞는 그룹 안에 둡니다.
  if (!Number.isFinite(incoming.position)) {
    insertionIndex = placement === "START" ? normalizedStart : insertionIndex;
  }
  next.splice(insertionIndex, 0, incoming);
  return next;
}

function insertAtServerNeighbors<T extends { id: string }>(
  items: T[],
  incoming: T,
  previousItemId: string | null,
  nextItemId: string | null,
  fallback: () => T[],
) {
  const previousIndex = previousItemId ? items.findIndex((item) => item.id === previousItemId) : -1;
  if (previousIndex >= 0) {
    const next = [...items];
    next.splice(previousIndex + 1, 0, incoming);
    return next;
  }
  const nextIndex = nextItemId ? items.findIndex((item) => item.id === nextItemId) : -1;
  if (nextIndex >= 0) {
    const next = [...items];
    next.splice(nextIndex, 0, incoming);
    return next;
  }
  return fallback();
}

function insertSectionByPosition(sections: SectionData[], incoming: SectionData) {
  const next = [...sections];
  const insertionIndex = next.findIndex((section) => (
    section.position > incoming.position
    || (section.position === incoming.position && section.id.localeCompare(incoming.id) > 0)
  ));
  next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, incoming);
  return next;
}

function updatePost(
  sections: SectionData[],
  postId: string,
  update: (post: PostData) => PostData,
) {
  return sections.map((section) => ({
    ...section,
    posts: section.posts.map((post) => post.id === postId ? update(post) : post),
  }));
}

/**
 * SSE의 완성된 델타를 현재 카드 배열에 적용합니다. 서버 스냅샷의 isMine/내 반응은 연결별 값이
 * 아니므로 기존 값을 보존하고, 글 본문 갱신이 그 사이 도착한 댓글·첨부 이벤트를 되돌리지 않게
 * 관련 컬렉션도 기존 카드가 있으면 유지합니다.
 */
export function applyBoardEventDelta(
  current: SectionData[],
  event: BoardEvent,
  placement: "START" | "END",
  currentUserId: string | null,
  preservePostLayout?: ReadonlySet<string>,
): SectionData[] {
  const payload = event.payload;

  if ((event.type === "post.created" || event.type === "post.updated") && payload?.post && event.sectionId) {
    const existingSection = current.find((section) => section.posts.some((post) => post.id === event.entityId));
    const existing = existingSection?.posts.find((post) => post.id === event.entityId);
    if (existing && payload.post.version < existing.version) return current;
    const post: PostData = existing
      ? {
          ...payload.post,
          isMine: payload.post.isMine || existing.isMine || Boolean(currentUserId && payload.post.author.id === currentUserId),
          attachments: existing.attachments,
          comments: existing.comments,
          commentCount: existing.commentCount,
          reactionCount: existing.reactionCount,
          reactionCounts: existing.reactionCounts,
          viewerReacted: existing.viewerReacted,
          viewerReactions: existing.viewerReactions,
        }
      : {
          ...payload.post,
          isMine: payload.post.isMine || Boolean(currentUserId && payload.post.author.id === currentUserId),
        };

    if (existingSection) {
      return current.map((section) => section.id !== existingSection.id
        ? section
        : {
            ...section,
            posts: payload.layoutChanged
              ? insertPostByPosition(section.posts.filter((item) => item.id !== post.id), post, placement)
              : section.posts.map((item) => item.id === post.id ? post : item),
          });
    }
    return current.map((section) => section.id !== event.sectionId
      ? section
      : {
          ...section,
          totalPostCount: section.totalPostCount + 1,
          posts: insertPostByPosition(section.posts, post, placement),
        });
  }

  if (event.type === "post.deleted") {
    // 페이지 밖 카드도 totalPostCount에는 들어 있습니다. 현재 배열에 카드가 있으면 낙관적 이동
    // 위치를 우선하고, 아직 받지 않은 카드면 이벤트의 서버 섹션에서 개수만 줄입니다.
    const localSectionId = current.find((section) => section.posts.some((post) => post.id === event.entityId))?.id;
    const countedSectionId = localSectionId ?? event.sectionId;
    return current.map((section) => {
      const posts = section.posts.filter((post) => post.id !== event.entityId);
      if (section.id !== countedSectionId && posts.length === section.posts.length) return section;
      return {
        ...section,
        totalPostCount: section.id === countedSectionId
          ? Math.max(0, section.totalPostCount - 1)
          : section.totalPostCount,
        posts,
      };
    });
  }

  if (event.type === "post.reordered" && payload?.postMove) {
    const moving = current.flatMap((section) => section.posts).find((post) => post.id === event.entityId);
    if (!moving || payload.postMove.version < moving.version) return current;
    if (preservePostLayout?.has(moving.id)) {
      // 다음 드래그/저장이 이미 시작됐으면 이전 저장의 확인은 버전만 전진시킵니다.
      // 본문과 로컬 섹션/이웃 순서는 그대로 두어 드래그 중 카드가 재마운트되지 않게 합니다.
      return updatePost(current, moving.id, (post) => ({ ...post, position: payload.postMove!.position, version: payload.postMove!.version }));
    }
    const sourceSectionId = current.find((section) => section.posts.some((post) => post.id === moving.id))?.id;
    return current.map((section) => {
      const without = section.posts.filter((post) => post.id !== moving.id);
      if (section.id !== payload.postMove!.sectionId) {
        return section.id === sourceSectionId
          ? { ...section, totalPostCount: Math.max(0, section.totalPostCount - 1), posts: without }
          : section;
      }
      const moved = { ...moving, position: payload.postMove!.position, version: payload.postMove!.version };
      return {
        ...section,
        totalPostCount: section.totalPostCount + (sourceSectionId === section.id ? 0 : 1),
        posts: insertAtServerNeighbors(
          without,
          moved,
          payload.postMove!.previousItemId,
          payload.postMove!.nextItemId,
          () => insertPostByPosition(without, moved, placement),
        ),
      };
    });
  }

  if (event.postId && event.type === "comment.created" && payload?.comment) {
    return updatePost(current, event.postId, (post) => {
      const previous = new Map(post.comments.map((comment) => [comment.id, comment]));
      const incoming = {
        ...payload.comment!,
        isMine: payload.comment!.isMine || previous.get(payload.comment!.id)?.isMine === true,
      };
      previous.set(incoming.id, incoming);
      const comments = [...previous.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
        .slice(-CARD_COMMENT_LIMIT);
      return { ...post, comments, commentCount: payload.commentCount ?? Math.max(post.commentCount, comments.length) };
    });
  }
  if (event.postId && event.type === "comment.updated" && payload?.commentPatch) {
    return updatePost(current, event.postId, (post) => ({
      ...post,
      comments: post.comments.map((comment) => comment.id === payload.commentPatch!.id ? { ...comment, ...payload.commentPatch } : comment),
    }));
  }
  if (event.postId && event.type === "comment.deleted") {
    return updatePost(current, event.postId, (post) => ({
      ...post,
      comments: post.comments.filter((comment) => comment.id !== event.entityId),
      commentCount: payload?.commentCount ?? Math.max(0, post.commentCount - 1),
    }));
  }

  if (event.postId && (event.type === "attachment.created" || event.type === "attachment.updated") && payload?.attachment) {
    return updatePost(current, event.postId, (post) => {
      const index = post.attachments.findIndex((attachment) => attachment.id === payload.attachment!.id);
      const attachments = index < 0
        ? [...post.attachments, payload.attachment!]
        : post.attachments.map((attachment) => attachment.id === payload.attachment!.id
          ? mergeAttachmentImage(attachment, event.type === "attachment.updated" && payload.attachmentPatch ? payload.attachmentPatch : payload.attachment!) : attachment);
      return { ...post, attachments };
    });
  }
  if (event.postId && event.type === "attachment.created" && payload?.commentAttachment) {
    return updatePost(current, event.postId, (post) => ({
      ...post,
      comments: post.comments.map((comment) => {
        if (comment.id !== payload.commentAttachment!.commentId) return comment;
        const incoming = payload.commentAttachment!.attachment;
        const index = comment.attachments.findIndex((attachment) => attachment.id === incoming.id);
        return {
          ...comment,
          attachments: index < 0
            ? [...comment.attachments, incoming]
            : comment.attachments.map((attachment) => attachment.id === incoming.id ? incoming : attachment),
        };
      }),
    }));
  }
  if (event.postId && event.type === "attachment.updated" && payload?.commentAttachmentPatch) {
    return updatePost(current, event.postId, (post) => ({
      ...post,
      comments: post.comments.map((comment) => comment.id === payload.commentAttachmentPatch!.commentId
        ? {
            ...comment,
            attachments: comment.attachments.map((attachment) => attachment.id === payload.commentAttachmentPatch!.attachmentPatch.id
              ? { ...attachment, ...payload.commentAttachmentPatch!.attachmentPatch }
              : attachment),
          }
        : comment),
    }));
  }
  if (event.postId && event.type === "attachment.deleted" && payload?.commentAttachmentDeleted) {
    return updatePost(current, event.postId, (post) => ({
      ...post,
      comments: post.comments.map((comment) => comment.id === payload.commentAttachmentDeleted!.commentId
        ? { ...comment, attachments: comment.attachments.filter((attachment) => attachment.id !== payload.commentAttachmentDeleted!.attachmentId) }
        : comment),
    }));
  }
  if (event.postId && event.type === "attachment.updated" && payload?.attachmentPatch) {
    return updatePost(current, event.postId, (post) => ({
      ...post,
      attachments: post.attachments.map((attachment) => attachment.id === payload.attachmentPatch!.id ? mergeAttachmentImage(attachment, payload.attachmentPatch!) : attachment),
    }));
  }
  if (event.postId && event.type === "attachment.updated" && payload?.attachmentIds) {
    return updatePost(current, event.postId, (post) => {
      const byId = new Map(post.attachments.map((attachment) => [attachment.id, attachment]));
      return { ...post, attachments: payload.attachmentIds!.flatMap((id) => byId.get(id) ?? []) };
    });
  }
  if (event.postId && event.type === "attachment.deleted") {
    return updatePost(current, event.postId, (post) => ({
      ...post,
      attachments: post.attachments.filter((attachment) => attachment.id !== event.entityId),
    }));
  }

  if (event.type === "reaction.changed" && event.postId && payload?.reactionCounts) {
    const reactionCount = payload.reactionCount
      ?? Object.values(payload.reactionCounts).reduce<number>((sum, count) => sum + (count ?? 0), 0);
    return updatePost(current, event.postId, (post) => ({
      ...post,
      reactionCount,
      reactionCounts: payload.reactionCounts!,
      ...(payload.actorReactions
        ? {
            viewerReactions: payload.actorReactions,
            viewerReacted: payload.actorReactions.includes("LIKE"),
          }
        : {}),
    }));
  }

  if (event.type === "section.created" && payload?.section) {
    if (current.some((section) => section.id === payload.section!.id)) return current;
    return insertSectionByPosition(current, payload.section);
  }
  if (event.type === "section.reordered" && payload?.sectionPatch && payload.sectionMove) {
    const moving = current.find((section) => section.id === event.entityId);
    if (!moving || payload.sectionMove.version < moving.version) return current;
    const moved = {
      ...moving,
      position: payload.sectionMove.position,
      version: payload.sectionMove.version,
    };
    const without = current.filter((section) => section.id !== moving.id);
    return insertAtServerNeighbors(
      without,
      moved,
      payload.sectionMove.previousItemId,
      payload.sectionMove.nextItemId,
      () => insertSectionByPosition(without, moved),
    );
  }
  if (event.type === "section.updated" && payload?.sectionPatch) {
    const patch = payload.sectionPatch;
    return current
      .map((section) => section.id === patch.id && (!patch.version || patch.version >= section.version)
        ? {
            ...section,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.description !== undefined ? { description: patch.description } : {}),
            ...(patch.position !== undefined ? { position: patch.position } : {}),
            ...(patch.version !== undefined ? { version: patch.version } : {}),
          }
        : section);
  }
  if (event.type === "section.deleted") return current.filter((section) => section.id !== event.entityId);

  return current;
}

/**
 * 새 글처럼 배치를 바꾸지 않는 서버 갱신을 현재 드래그 결과에 합칩니다.
 * 기존 카드의 섹션과 순서는 클라이언트 배열을 따르고, 서버에서 처음 본 카드만 보드의
 * 새 글 배치 정책에 맞춰 넣습니다. 실제 재정렬 이벤트는 이 함수를 거치지 않고 서버 배열을 받습니다.
 */
export function reconcileSectionsPreservingLayout(
  current: SectionData[],
  incoming: SectionData[],
  placement: "START" | "END",
): SectionData[] {
  const incomingSections = new Map(incoming.map((section) => [section.id, section]));
  const incomingPosts = new Map(incoming.flatMap((section) => section.posts.map((post) => [post.id, post] as const)));
  const currentPostIds = new Set(current.flatMap((section) => section.posts.map((post) => post.id)));
  const currentSectionIds = new Set(current.map((section) => section.id));
  const orderedSections = [
    ...current.filter((section) => incomingSections.has(section.id)),
    ...incoming.filter((section) => !currentSectionIds.has(section.id)),
  ];

  return orderedSections.map((currentSection) => {
    const serverSection = incomingSections.get(currentSection.id) ?? currentSection;
    const existingInCurrentSection = currentSection.posts.map((post) => {
      const serverPost = incomingPosts.get(post.id);
      // 서버 컴포넌트 갱신은 첫 페이지만 다시 보냅니다. 사용자가 이미 "더 보기"로 받은
      // 뒷페이지 카드는 응답에 없다는 이유만으로 버리지 않고, 삭제/재정렬 이벤트가 오면
      // 별도 경로에서 제거하거나 전체 로컬 배치를 비웁니다.
      return serverPost ? { ...serverPost, attachments: preserveImageRevisions(post.attachments, serverPost.attachments) } : post;
    });
    const newInServerSection = serverSection.posts.filter((post) => !currentPostIds.has(post.id));
    const posts = mergeNewPosts(existingInCurrentSection, newInServerSection, placement);

    const hasClientOnlyPage = currentSection.posts.some((post) => !incomingPosts.has(post.id));
    return {
      ...serverSection,
      posts,
      // 낡은 서버 렌더가 카드 이동 전 섹션별 개수를 담고 있어도 현재 화면에 보존한 카드 수보다
      // 작아질 수는 없습니다. 그렇지 않으면 헤더는 2개라면서 카드가 3개 보입니다.
      totalPostCount: Math.max(serverSection.totalPostCount, posts.length),
      nextCursor: hasClientOnlyPage ? currentSection.nextCursor ?? null : serverSection.nextCursor ?? null,
    };
  });
}
