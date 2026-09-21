"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Globe2, KeyRound, Link2, LoaderCircle, LockKeyhole, LockOpen, UserRoundPlus } from "lucide-react";
import { OptionPicker } from "@/components/pad/settings/option-picker";
import type { PadData } from "@/components/pad/types";
import { boardAcceptsGuestPosts } from "@/lib/board/visitor-policy";
import settingsStyles from "@/components/pad/settings/settings.module.css";
import styles from "@/components/pad/settings/pad-sharing-settings.module.css";

type Preset = "private" | "link" | "public";

const PRESETS: Record<Preset, {
  discoveryScope: PadData["discoveryScope"];
  visitorPermission: PadData["visitorPermission"];
  loginRequired: boolean;
}> = {
  private: { discoveryScope: "PRIVATE", visitorPermission: "NO_ACCESS", loginRequired: true },
  link: { discoveryScope: "LINK", visitorPermission: "READER", loginRequired: false },
  public: { discoveryScope: "PUBLIC", visitorPermission: "READER", loginRequired: false },
};

function presetFor(board: Pick<PadData, "discoveryScope">): Preset {
  if (board.discoveryScope === "PUBLIC") return "public";
  if (board.discoveryScope === "LINK") return "link";
  return "private";
}

// 발견 범위와 참여 권한은 별개입니다. LINK/PUBLIC 모두 손님 쓰기를 명시적으로 열 수 있고,
// URL 복사·QR은 상단 공유 패널에 둡니다. 서버와 같은 순수 정책으로 초기 상태를 판정합니다.
export function PadSharingSettings({ board, isOwner }: {
  board: Pick<PadData, "id" | "discoveryScope" | "visitorPermission" | "loginRequired" | "hasPassword" | "guestPostsRequireApproval">;
  isOwner: boolean;
}) {
  const [preset, setPreset] = useState<Preset>(presetFor(board));
  const [guestWrite, setGuestWrite] = useState(boardAcceptsGuestPosts(board));
  const [requireApproval, setRequireApproval] = useState(board.guestPostsRequireApproval);
  const [hasPassword, setHasPassword] = useState(board.hasPassword);
  const [pending, setPending] = useState(false);
  const [revealPending, setRevealPending] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    setPending(true);

    try {
      const form = event.currentTarget;
      const data = new FormData(form);
      const nextPassword = String(data.get("password") ?? "").trim();
      const body: Record<string, unknown> = { ...PRESETS[preset] };
      if (preset !== "private" && guestWrite) {
        body.visitorPermission = "WRITER";
        body.guestPostsRequireApproval = requireApproval;
      }

      // 빈칸은 현재 비밀번호 유지입니다. 비밀번호 해제는 아래의 명시적인 버튼만 사용합니다.
      if (nextPassword) body.password = nextPassword;

      const response = await fetch(`/api/boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "공개 설정을 저장하지 못했습니다.");
        return;
      }

      setHasPassword(result.board.hasPassword);
      setRevealedPassword(null);
      form.reset();
      setSaved(true);
    } catch {
      setError("네트워크 오류로 공개 설정을 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function removePassword() {
    setError("");
    setSaved(false);
    setPending(true);

    try {
      const response = await fetch(`/api/boards/${board.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: null }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "비밀번호 보호를 해제하지 못했습니다.");
        return;
      }

      setHasPassword(false);
      setRevealedPassword(null);
      setSaved(true);
    } catch {
      setError("네트워크 오류로 비밀번호 보호를 해제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function togglePasswordVisibility() {
    if (revealedPassword !== null) {
      setRevealedPassword(null);
      return;
    }

    setError("");
    setRevealPending(true);
    try {
      const response = await fetch(`/api/boards/${board.id}/password`, { method: "POST", cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "비밀번호를 불러오지 못했습니다.");
        return;
      }
      setRevealedPassword(result.password);
    } catch {
      setError("네트워크 오류로 비밀번호를 불러오지 못했습니다.");
    } finally {
      setRevealPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={saveSettings}>
      <fieldset className={settingsStyles.group}>
        <legend>발견 범위</legend>
        <p className={styles.groupDescription}>누가 패드를 찾고 열 수 있는지 정합니다. 방문자는 기본적으로 읽기 전용이에요.</p>
        <OptionPicker
          name="discoveryScope"
          value={preset}
          onChange={(value) => { setPreset(value); setGuestWrite(false); setRequireApproval(true); setSaved(false); }}
          options={[
            { value: "private", label: "비공개", description: "소유자와 초대받은 멤버만 열 수 있어요.", icon: <LockKeyhole size={18} /> },
            { value: "link", label: "링크 공개", description: "링크를 받은 사람만 열 수 있고, 공개 목록과 검색에는 노출되지 않아요.", icon: <Link2 size={18} /> },
            { value: "public", label: "전체 공개", description: "공개 목록과 검색에 노출돼요.", icon: <Globe2 size={18} /> },
          ]}
        />
      </fieldset>

      {preset !== "private" && (
        <fieldset className={settingsStyles.group}>
          <legend>손님 글쓰기</legend>
          <p className={styles.groupDescription}>로그인하지 않은 사람도 이름만 적고 글과 사진을 올릴 수 있게 합니다. 수업 중 QR로 모을 때 쓰세요.</p>
          <div className={styles.passwordHeading}>
            <span className={styles.icon}><UserRoundPlus size={17} /></span>
            <span>
              <b>{guestWrite ? "손님도 글을 쓸 수 있어요" : "쓰기 권한이 있는 멤버만 글을 쓸 수 있어요"}</b>
              <small>손님은 이름만 남기고, 자기가 쓴 글만 고치거나 지울 수 있어요. 첨부는 사진만 됩니다.</small>
            </span>
          </div>
          <label className={settingsStyles.check}>
            <input type="checkbox" checked={guestWrite} onChange={(event) => { setGuestWrite(event.target.checked); if (event.target.checked) setRequireApproval(true); setSaved(false); }} />
            <span>비로그인 손님도 글쓰기 허용<small>끄면 기존 글은 남지만 손님의 작성·수정·삭제·첨부가 막혀요.</small></span>
          </label>
          {guestWrite && (
            <label className={settingsStyles.check}>
              <input type="checkbox" checked={requireApproval} onChange={(event) => { setRequireApproval(event.target.checked); setSaved(false); }} />
              <span>손님 글은 승인한 뒤 공개<small>끄면 올리는 즉시 모두에게 보여요. 켜 두는 걸 권합니다.</small></span>
            </label>
          )}
          {guestWrite && <p className={styles.groupDescription}>댓글을 허용한 패드에서는 손님도 댓글을 쓸 수 있어요. 댓글은 승인 없이 바로 표시됩니다.{preset === "link" ? " 링크가 전달되면 받은 사람도 참여할 수 있으니, 필요하면 비밀번호를 설정하세요." : ""}</p>}
        </fieldset>
      )}

      <fieldset className={settingsStyles.group}>
        <legend>비밀번호</legend>
        <div className={styles.passwordHeading}>
          <span className={styles.icon}><KeyRound size={17} /></span>
          <span>
            <b>{hasPassword ? "현재 비밀번호로 보호 중" : "추가 보호가 꺼져 있어요"}</b>
            <small>공개 범위와 별개로 패드를 열 때 비밀번호를 확인합니다.</small>
          </span>
        </div>
        <label className={settingsStyles.field}>
          <span>{hasPassword ? "새 비밀번호" : "비밀번호 설정"}</span>
          <input type="password" name="password" placeholder={hasPassword ? "바꿀 때만 6자 이상 입력" : "6자 이상 입력"} minLength={6} maxLength={100} autoComplete="new-password" />
          {hasPassword && <small>빈칸으로 저장하면 현재 비밀번호를 유지합니다.</small>}
        </label>
        {hasPassword && (
          <div className={styles.passwordActions}>
            {isOwner && (
              <button type="button" className="button" onClick={() => void togglePasswordVisibility()} disabled={pending || revealPending}>
                {revealPending
                  ? <LoaderCircle size={15} className="spin" />
                  : revealedPassword === null ? <Eye size={15} /> : <EyeOff size={15} />}
                {revealPending ? "불러오는 중…" : revealedPassword === null ? "현재 비밀번호 보기" : "비밀번호 숨기기"}
              </button>
            )}
            <button type="button" className="button danger" onClick={() => void removePassword()} disabled={pending || revealPending}>
              <LockOpen size={15} />비밀번호 해제
            </button>
          </div>
        )}
        {revealedPassword !== null && (
          <output className={styles.revealedPassword} aria-live="polite">
            <span>현재 비밀번호</span>
            <strong>{revealedPassword}</strong>
          </output>
        )}
      </fieldset>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className={styles.actions}>
        {saved && <span>공개 설정이 저장됐어요.</span>}
        <button type="submit" className="button primary" disabled={pending}>
          {pending && <LoaderCircle size={15} className="spin" />}
          {pending ? "저장하는 중…" : "공개 설정 저장"}
        </button>
      </div>
    </form>
  );
}
