"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 문서 하나를 통째로 저장하는 편집기의 저장 오케스트레이션입니다. 퀴즈 편집기와 설문 편집기가
// 함께 씁니다.
//
// 저장 자체(무엇을 어디로 보낼지)는 호출자가 합니다. 여기서 맡는 것은 매번 똑같이 필요하고
// 매번 똑같이 틀리기 쉬운 네 가지입니다.
//
//   1. **덮어쓰기 방지.** 저장 요청이 도는 동안 사용자가 계속 타이핑하면, 돌아온 서버 응답을
//      그대로 화면에 넣는 순간 그 사이의 편집이 사라집니다. 편집마다 번호를 올려 두고 응답을
//      적용하기 직전에 번호가 그대로인지 확인합니다.
//   2. **동시 저장 방지.** 자동 저장 타이머와 Ctrl+S가 겹치면 같은 문서가 두 번 날아갑니다.
//   3. **자동 저장.** 30초마다, 바뀐 게 있고 저장 중이 아닐 때만.
//   4. **나가기 경고.** 저장 안 한 변경이 있으면 새로고침·닫기를 막습니다.
//
// 콜백은 ref로 붙잡습니다 — 타이머와 keydown 리스너는 한 번만 등록하는데, 그 안에서 부르는
// 저장 함수는 매 렌더의 최신 상태를 봐야 합니다.

export type SaveMode = "manual" | "auto" | "silent";

export type SaveContext = {
  mode: SaveMode;
  /**
   * 요청을 보낸 뒤 사용자가 더 편집하지 않았는지. **서버 응답을 화면에 적용하기 직전에**
   * 확인하세요. false면 응답을 버리고 화면의 편집 중인 내용을 그대로 둡니다.
   */
  isCurrent: () => boolean;
};

export type DocumentSave = {
  dirty: boolean;
  saving: boolean;
  /** 편집이 일어났다고 알립니다. 상태를 바꾸는 모든 자리에서 부릅니다. */
  markDirty: () => void;
  /** 저장을 실행합니다. 실패했거나 저장 중 추가 편집이 생겼으면 false를 돌려줍니다. */
  save: (mode?: SaveMode) => Promise<boolean>;
  /** 저장 성공으로 표시하고 dirty를 내립니다. 저장 밖에서 문서를 새로 받았을 때 씁니다. */
  markClean: () => void;
};

export const AUTOSAVE_INTERVAL_MS = 30_000;

export function useDocumentSave(options: {
  /** 실제 저장. 성공이면 true를 돌려주세요 — 그때만 dirty가 내려갑니다. */
  onSave: (context: SaveContext) => Promise<boolean>;
  /** 자동 저장 주기. 0이면 자동 저장을 끕니다. */
  intervalMs?: number;
  /** 자동 저장을 잠시 멈출 조건(예: 아직 문서를 못 불러옴). */
  enabled?: boolean;
}): DocumentSave {
  const { onSave, intervalMs = AUTOSAVE_INTERVAL_MS, enabled = true } = options;

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // 편집마다 올라가는 번호. 저장 요청 전에 찍어 두고 응답 적용 직전에 비교합니다.
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const onSaveRef = useRef(onSave);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    onSaveRef.current = onSave;
    enabledRef.current = enabled;
  });

  const markDirty = useCallback(() => {
    versionRef.current += 1;
    dirtyRef.current = true;
    setDirty(true);
  }, []);

  const markClean = useCallback(() => {
    dirtyRef.current = false;
    setDirty(false);
  }, []);

  const save = useCallback(async (mode: SaveMode = "manual") => {
    if (savingRef.current) return false;
    const startedAt = versionRef.current;
    savingRef.current = true;
    setSaving(true);
    try {
      const ok = await onSaveRef.current({ mode, isCurrent: () => versionRef.current === startedAt });
      // 저장하는 사이에 또 편집했다면 dirty를 유지합니다 — 내려 버리면 그 편집이 저장되지
      // 않은 채 "저장됨"으로 보입니다.
      const stayedCurrent = versionRef.current === startedAt;
      if (ok && stayedCurrent) markClean();
      // 발행·마감처럼 저장 직후 상태를 바꾸는 호출자는, 요청 중 추가 편집이 있었다면 다음
      // 동작으로 넘어가면 안 됩니다. 서버 저장 자체는 성공했어도 최신 로컬 문서는 아직 dirty입니다.
      return ok && stayedCurrent;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [markClean]);

  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  // Ctrl/Cmd+S
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (enabledRef.current && dirtyRef.current && !savingRef.current) void saveRef.current("manual");
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // 자동 저장
  useEffect(() => {
    if (!intervalMs) return;
    const timer = window.setInterval(() => {
      if (enabledRef.current && dirtyRef.current && !savingRef.current) void saveRef.current("auto");
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  // 나가기 경고
  useEffect(() => {
    function guard(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
    }
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  return { dirty, saving, markDirty, save, markClean };
}

/**
 * 잠깐 떴다 사라지는 안내 문구. 저장 결과를 알리는 데 쓰므로 저장 훅 옆에 둡니다.
 * 언마운트될 때 타이머를 정리하지 않으면 사라진 컴포넌트에 setState가 걸립니다.
 */
export function useFlash(durationMs = 2200) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const flash = useCallback((next: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setMessage(next);
    timerRef.current = window.setTimeout(() => setMessage(null), durationMs);
  }, [durationMs]);

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  return { message, flash };
}
