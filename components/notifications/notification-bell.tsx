"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import { PadAccessRequests } from "@/components/pad/pad-access-requests";
import { Modal } from "@/components/ui/modal";
import { boardPostRoutePath, boardRoutePath } from "@/lib/board/route-paths";
import { PAD_HOME_PATH, QUIZ_ASSIGNMENTS_PATH, quizDetailPath } from "@/lib/route-paths";

export type NotificationDTO = {
  id: string;
  // 퀴즈 알림 두 종류(QUIZ_ASSIGNED·QUIZ_SHARED)가 이 목록에서 빠져 있었습니다. 스키마에는
  // 있고 실제로 만들어지는데 여기 없으니 describe()가 default로 떨어져 "새 알림이 있어요"만
  // 뜨고, 눌러도 갈 곳이 없어 아무 일도 일어나지 않았습니다.
  type: "POST_COMMENTED" | "REACTION_ON_POST" | "MEMBER_JOINED" | "ACCESS_REQUEST_RECEIVED" | "ACCESS_REQUEST_APPROVED" | "ACCESS_REQUEST_REJECTED" | "POST_APPROVED" | "POST_REJECTED" | "POST_PENDING_REVIEW" | "COMMENT_MENTIONED" | "ACCOUNT_APPROVAL_REQUESTED" | "ACCOUNT_APPROVAL_APPROVED" | "ACCOUNT_APPROVAL_REJECTED" | "TEACHER_APPROVAL_REQUESTED" | "TEACHER_APPROVAL_APPROVED" | "TEACHER_APPROVAL_REJECTED" | "QUIZ_ASSIGNED" | "QUIZ_SHARED" | "FORM_SHARED" | "FORM_RESPONSE_DIGEST";
  readAt: string | null;
  createdAt: string;
  actor: { id: string; name: string | null } | null;
  board: { id: string; slug: string; title: string } | null;
  accessRequestId: string | null;
  post: { id: string; title: string | null } | null;
  quiz: { id: string; title: string } | null;
  form: { id: string; title: string } | null;
  responseCount: number | null;
  commentId: string | null;
};

export type NotificationBellData = { notifications: NotificationDTO[]; unreadCount: number };

function describe(item: NotificationDTO) {
  const actor = item.actor?.name || "누군가";
  const boardTitle = item.board?.title || "패드";
  const postTitle = item.post?.title ? `"${item.post.title}"` : "내 글";
  // 제목이 없을 때 "퀴즈 퀴즈를"처럼 겹치지 않도록 "퀴즈"까지 라벨에 넣습니다.
  const quizLabel = item.quiz?.title ? `"${item.quiz.title}" 퀴즈` : "퀴즈";
  switch (item.type) {
    case "POST_COMMENTED": return `${actor}님이 ${postTitle}에 댓글을 남겼어요`;
    case "COMMENT_MENTIONED": return `${actor}님이 ${postTitle}의 댓글에서 나를 언급했어요`;
    case "REACTION_ON_POST": return `${actor}님이 ${postTitle}에 반응했어요`;
    case "MEMBER_JOINED": return `${actor}님이 ${boardTitle}에 참여했어요`;
    case "ACCESS_REQUEST_RECEIVED": return `${actor}님이 ${boardTitle} 접근을 요청했어요`;
    case "ACCESS_REQUEST_APPROVED": return `${boardTitle} 접근 요청이 승인되었어요`;
    case "ACCESS_REQUEST_REJECTED": return `${boardTitle} 접근 요청이 거절되었어요`;
    case "POST_APPROVED": return `${postTitle}이(가) 승인되었어요`;
    case "POST_REJECTED": return `${postTitle}이(가) 거절되었어요`;
    case "POST_PENDING_REVIEW": return `${boardTitle}에 승인 대기 글이 있어요`;
    case "ACCOUNT_APPROVAL_REQUESTED": return `${actor}님이 새 계정 가입을 요청했어요`;
    case "ACCOUNT_APPROVAL_APPROVED": return "계정 가입 요청이 승인되었어요";
    case "ACCOUNT_APPROVAL_REJECTED": return "계정 가입 요청이 반려되었어요";
    case "TEACHER_APPROVAL_REQUESTED": return `${actor}님이 교사 가입 승인을 요청했어요`;
    case "TEACHER_APPROVAL_APPROVED": return "교사 가입 요청이 승인되었어요";
    case "TEACHER_APPROVAL_REJECTED": return "교사 가입 요청이 반려되었어요";
    case "QUIZ_ASSIGNED": return `${actor}님이 ${quizLabel}를 할당했어요`;
    case "QUIZ_SHARED": return `${actor}님이 ${quizLabel}를 공유했어요`;
    case "FORM_SHARED": return `${actor}님이 ${item.form?.title ? `"${item.form.title}" 설문을` : "설문을"} 공유했어요`;
    case "FORM_RESPONSE_DIGEST": return `${item.form?.title ? `"${item.form.title}"` : "설문"}에 새 응답 ${item.responseCount ?? 0}건이 들어왔어요`;
    default: return "새 알림이 있어요";
  }
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function NotificationBell({ initialData }: { initialData: NotificationBellData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDTO[]>(initialData.notifications);
  const [unreadCount, setUnreadCount] = useState(initialData.unreadCount);
  const [loading, setLoading] = useState(false);
  const [detailsReady, setDetailsReady] = useState(initialData.notifications.length > 0);
  const [accessRequestModal, setAccessRequestModal] = useState<{
    boardId: string;
    boardTitle: string;
    requestId?: string;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const detailsLoaded = useRef(initialData.notifications.length > 0);
  // SSE 이벤트·읽음처리·모두읽음이 거의 동시에 load()를 부를 수 있어, 응답이 "보낸 순서"가
  // 아니라 "도착한 순서"로 반영되면 최신 알림이 온 뒤에 더 오래된 응답이 덮어쓸 수 있었습니다.
  // 요청마다 순번을 매겨 가장 최근에 보낸 요청의 응답만 반영합니다.
  const unreadLoadSeq = useRef(0);
  const detailLoadSeq = useRef(0);
  const summaryControllerRef = useRef<AbortController | null>(null);
  const detailControllerRef = useRef<AbortController | null>(null);

  async function load(includeDetails = detailsLoaded.current) {
    const controllerRef = includeDetails ? detailControllerRef : summaryControllerRef;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const unreadSeq = ++unreadLoadSeq.current;
    const detailSeq = includeDetails ? ++detailLoadSeq.current : 0;
    if (includeDetails) setLoading(true);
    try {
      const response = await fetch(includeDetails ? "/api/notifications" : "/api/notifications?summary=1", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) return;
      const result = await response.json() as NotificationBellData;
      if (includeDetails) {
        if (detailSeq !== detailLoadSeq.current) return;
        detailsLoaded.current = true;
        setDetailsReady(true);
        setItems(result.notifications);
      }
      if (unreadSeq === unreadLoadSeq.current) setUnreadCount(result.unreadCount);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      // 네트워크가 끊긴 동안의 보충 조회 실패는 조용히 넘깁니다. 다음 SSE 이벤트나
      // 재연결 직후의 조회가 같은 목록을 다시 가져옵니다.
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (includeDetails && detailSeq === detailLoadSeq.current && !controller.signal.aborted) setLoading(false);
    }
  }

  // 서버는 한 사용자당 SSE 연결을 6개로 제한하고 넘으면 429 + Retry-After를 돌려줍니다
  // (app/api/notifications/events/route.ts). EventSource는 **비-2xx 응답을 받으면 스스로
  // 재연결하지 않고 연결을 CLOSED로 끝냅니다** — 예전에는 error 핸들러조차 없어서, 탭을
  // 여러 개 열어 한도를 넘긴 순간 그 탭의 알림이 조용히 죽고 새로고침 전까지 돌아오지
  // 않았습니다. 그래서 직접 다시 열되, 폭주하지 않도록 지수 백오프를 겁니다.
  //
  // 지연에 난수를 섞는 이유는 여러 탭이 같은 순간에 끊겼을 때(서버 재시작 등) 똑같은
  // 간격으로 동시에 몰려와 다시 429를 맞는 것을 막기 위해서입니다.
  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let attempt = 0;
    let disposed = false;

    function clearTimer() {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    function connect() {
      // 숨은 탭마다 SSE를 계속 붙잡으면 학교에서 여러 탭을 열었을 때 브라우저·서버 연결 수만
      // 늘어납니다. 다시 보이는 순간 요약을 재조회하므로 백그라운드에서는 연결하지 않습니다.
      if (disposed || document.visibilityState !== "visible") return;
      clearTimer();
      source?.close();
      source = new EventSource("/api/notifications/events");
      source.addEventListener("open", () => {
        // 연결이 실제로 열렸을 때만 백오프를 되돌립니다. 열자마자 다시 끊기는 상황에서
        // 여기서 리셋하지 않으면 1초 간격 재시도가 무한히 이어집니다.
        attempt = 0;
      });
      source.addEventListener("notification", () => void load(detailsLoaded.current));
      source.addEventListener("error", () => {
        // CONNECTING이면 브라우저가 알아서 다시 붙는 중이라 건드리지 않습니다. 우리가
        // 개입해야 하는 건 브라우저가 포기한 CLOSED뿐입니다.
        if (disposed || document.visibilityState !== "visible" || source?.readyState !== EventSource.CLOSED) return;
        source.close();
        source = null;
        attempt += 1;
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 5 * 60_000);
        retryTimer = window.setTimeout(connect, backoff * (0.7 + Math.random() * 0.6));
      });
    }

    // 백그라운드 탭이 긴 백오프에 들어간 상태에서 사용자가 돌아오면, 남은 대기를 기다리지
    // 않고 바로 다시 붙습니다. 돌아온 화면의 알림이 몇 분씩 멎어 있으면 안 됩니다.
    function onVisibilityChange() {
      if (disposed) return;
      if (document.visibilityState !== "visible") {
        clearTimer();
        source?.close();
        source = null;
        summaryControllerRef.current?.abort();
        detailControllerRef.current?.abort();
        return;
      }
      if (source === null || source.readyState === EventSource.CLOSED) {
        attempt = 0;
        connect();
        void load(detailsLoaded.current);
      }
    }

    if (document.visibilityState === "visible") connect();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      source?.close();
      source = null;
    };
  }, []);

  useEffect(() => () => {
    summaryControllerRef.current?.abort();
    detailControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  async function openNotification(item: NotificationDTO) {
    if (!item.readAt) {
      await fetch(`/api/notifications/${item.id}`, { method: "PATCH" });
      void load();
    }
    setOpen(false);
    if (item.type === "ACCESS_REQUEST_RECEIVED" && item.board) {
      setAccessRequestModal({
        boardId: item.board.id,
        boardTitle: item.board.title,
        requestId: item.accessRequestId ?? undefined,
      });
    } else if (item.board) {
      const target = item.post
        ? `${boardPostRoutePath(item.board.slug, item.post.id)}${item.commentId ? `#comment-${encodeURIComponent(item.commentId)}` : ""}`
        : boardRoutePath(item.board.slug);
      router.push(target);
    } else if (item.type === "ACCOUNT_APPROVAL_REQUESTED" || item.type === "TEACHER_APPROVAL_REQUESTED") {
      router.push("/admin/approvals");
    } else if (item.type === "ACCOUNT_APPROVAL_APPROVED") {
      router.push("/onboarding");
    } else if (item.type === "ACCOUNT_APPROVAL_REJECTED") {
      router.push("/approval-pending");
    } else if (item.type === "TEACHER_APPROVAL_APPROVED") {
      router.push(PAD_HOME_PATH);
    } else if (item.type === "TEACHER_APPROVAL_REJECTED") {
      router.push("/onboarding");
    } else if (item.type === "QUIZ_ASSIGNED") {
      // 할당은 학생이 받는 알림이고, 풀러 가는 곳은 할당 퀴즈 목록입니다.
      router.push(QUIZ_ASSIGNMENTS_PATH);
    } else if (item.type === "QUIZ_SHARED" && item.quiz) {
      // 상세 페이지가 권한을 다시 보고 편집 가능하면 편집기로 넘겨 줍니다.
      router.push(quizDetailPath(item.quiz.id));
    } else if ((item.type === "FORM_SHARED" || item.type === "FORM_RESPONSE_DIGEST") && item.form) {
      router.push(item.type === "FORM_RESPONSE_DIGEST" ? `/forms/${item.form.id}/responses` : `/forms/${item.form.id}`);
    }
  }

  async function readAll() {
    await fetch("/api/notifications/read-all", { method: "POST" });
    void load();
  }

  function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next && !detailsLoaded.current) void load(true);
  }

  return (
    <div className="notification-bell" ref={panelRef}>
      <button type="button" className="icon-button" aria-label="알림" onClick={togglePanel}>
        <Bell size={17} />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-panel" role="dialog" aria-label="알림">
          <header>
            <b>알림</b>
            {unreadCount > 0 && <button type="button" onClick={readAll}><Check size={13} />모두 읽음</button>}
          </header>
          {loading && !detailsReady ? (
            <p className="notification-empty">알림을 불러오는 중…</p>
          ) : items.length ? (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className={item.readAt ? "" : "unread"} onClick={() => openNotification(item)}>
                    <span>{describe(item)}</span>
                    <small>{relativeTime(item.createdAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="notification-empty">아직 알림이 없어요.</p>
          )}
        </div>
      )}
      <Modal
        open={accessRequestModal !== null}
        onClose={() => setAccessRequestModal(null)}
        title="패드 접근 요청"
        description={accessRequestModal ? `${accessRequestModal.boardTitle}에 참여하려는 사용자를 확인합니다.` : undefined}
        className="modal-md"
      >
        {accessRequestModal && (
          <div className="notification-access-request-body">
            <PadAccessRequests
              boardId={accessRequestModal.boardId}
              requestId={accessRequestModal.requestId}
              onResolved={() => {
                setAccessRequestModal(null);
                void load(true);
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
