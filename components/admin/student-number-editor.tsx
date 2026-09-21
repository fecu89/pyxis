"use client";

import { useState, type FormEvent } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { AdminUserRecord } from "@/components/admin/types";

export function StudentNumberEditor({
  userId,
  userName,
  initialValue,
  source,
  onSaved,
}: {
  userId: string;
  userName: string;
  initialValue: number | null;
  source: "사용자 관리" | "소속 관리";
  onSaved: (user: AdminUserRecord) => void;
}) {
  const [draft, setDraft] = useState(initialValue?.toString() ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const normalized = draft.trim();
  const number = normalized ? Number(normalized) : null;
  const valid = number === null || (Number.isInteger(number) && number >= 1 && number <= 99);
  const dirty = number !== initialValue;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !dirty || pending) return;
    setPending(true);
    setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentNumber: number,
          reason: `${source}에서 학생 번호 ${number === null ? "해제" : "지정"}`,
        }),
      });
      const result = await response.json() as { user?: AdminUserRecord; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error || "학생 번호를 저장하지 못했습니다.");
      onSaved(result.user);
      setDraft(result.user.studentNumber?.toString() ?? "");
      setNotice("저장됨");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="student-number-editor" onSubmit={submit}>
      <label>
        <span className="sr-only">{userName} 학생 번호</span>
        <input
          type="number"
          min={1}
          max={99}
          step={1}
          inputMode="numeric"
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setNotice(""); }}
          placeholder="미지정"
          disabled={pending}
          aria-invalid={!valid}
        />
        <span>번</span>
      </label>
      <button type="submit" className="icon-button small" disabled={!valid || !dirty || pending} aria-label={`${userName} 학생 번호 저장`}>
        {pending ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}
      </button>
      {notice ? <small data-error={notice !== "저장됨"}>{notice}</small> : null}
    </form>
  );
}
