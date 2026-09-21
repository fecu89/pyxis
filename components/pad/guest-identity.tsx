"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, UserRound } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { requestJson } from "@/lib/api-client";
import type { PadViewer } from "@/components/pad/types";

const GUEST_NAME_MAX = 20;

/**
 * 비로그인 손님의 표시 이름을 다루는 곳입니다.
 *
 * 손님에게 **처음부터** 이름을 묻지 않습니다. 패드를 열자마자 이름 입력창이 뜨면 그냥 구경만
 * 하려던 사람도 막히고, 링크를 눌렀는데 폼부터 나오는 화면은 가입처럼 보입니다. 그래서 이름은
 * 실제로 뭔가를 쓰려는 순간 — 글 작성 버튼을 누르거나 댓글을 보내려는 그때 — 한 번만 묻습니다.
 *
 * 이름은 권한이 아닙니다. 서버는 이름이 있든 없든 보드 설정을 다시 읽어 판단하고, 여기서
 * 하는 일은 "누가 썼는지 화면에 뭐라고 적을지"와 "다음에 또 묻지 않기"뿐입니다.
 */

type GuestIdentity = {
  /** 로그인 사용자면 null. 손님인데 아직 이름을 안 남겼어도 null입니다. */
  guestName: string | null;
  /** 이 패드가 손님 글쓰기를 받는 상태인가. 로그인 사용자에게는 항상 false입니다. */
  guestWriteOpen: boolean;
  /**
   * 글쓰기 직전에 부릅니다. 이름이 이미 있으면 그대로 통과(true)하고, 없으면 입력창을 띄운 뒤
   * 저장에 성공해야 true입니다. 취소하면 false — 부른 쪽은 작성 화면을 열지 않으면 됩니다.
   */
  ensureName: () => Promise<boolean>;
};

const GuestIdentityContext = createContext<GuestIdentity>({
  guestName: null,
  guestWriteOpen: false,
  ensureName: async () => true,
});

export function useGuestIdentity() {
  return useContext(GuestIdentityContext);
}

export function GuestIdentityProvider({ boardId, viewer, children }: {
  boardId: string;
  viewer: PadViewer;
  children: ReactNode;
}) {
  const [guestName, setGuestName] = useState(viewer.guestName);
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // 입력창이 닫힐 때 기다리던 쪽에 결과를 돌려주기 위한 resolve 보관함입니다. 상태로 두면
  // 이름을 입력하는 동안 매 글자마다 다시 그려집니다.
  const resolveRef = useRef<((accepted: boolean) => void) | null>(null);

  const finish = useCallback((accepted: boolean) => {
    setAsking(false);
    setError("");
    resolveRef.current?.(accepted);
    resolveRef.current = null;
  }, []);

  const ensureName = useCallback(async () => {
    if (!viewer.guestWriteOpen || guestName) return true;
    setAsking(true);
    return new Promise<boolean>((resolve) => { resolveRef.current = resolve; });
  }, [guestName, viewer.guestWriteOpen]);

  async function submitName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!value) return setError("이름을 입력해 주세요.");
    setPending(true);
    setError("");
    try {
      const result = await requestJson<{ guest: { name: string } }>(`/api/boards/${boardId}/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      setGuestName(result.guest.name);
      finish(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이름을 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  const value = useMemo<GuestIdentity>(
    () => ({ guestName, guestWriteOpen: viewer.guestWriteOpen, ensureName }),
    [guestName, viewer.guestWriteOpen, ensureName],
  );

  return (
    <GuestIdentityContext.Provider value={value}>
      {children}
      <Modal
        open={asking}
        onClose={() => finish(false)}
        title="어떤 이름으로 올릴까요?"
        description="로그인하지 않아도 글과 댓글을 쓸 수 있어요. 여기 적은 이름이 함께 보입니다."
      >
        <form className="stack-form" onSubmit={submitName}>
          <label>
            이름
            <input
              name="name"
              maxLength={GUEST_NAME_MAX}
              required
              autoFocus
              autoComplete="off"
              placeholder="예: 3반 김하늘"
            />
          </label>
          <p className="form-hint">
            <UserRound size={13} /> 계정을 만들지 않아요. 이 브라우저에서만 기억하고, 자기가 쓴 글과 댓글만 고치거나 지울 수 있어요.
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button primary full" disabled={pending}>
            {pending && <LoaderCircle size={15} className="spin" />}
            {pending ? "저장하는 중…" : "이 이름으로 시작"}
          </button>
        </form>
      </Modal>
    </GuestIdentityContext.Provider>
  );
}
