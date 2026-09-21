"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const draftVersion = 1;
const autosaveDelayMs = 700;
const draftKeyPrefix = "pyxcourse:post-draft:";
const legacyDraftKeyPrefix = "pyxpad:post-draft:";
// 저장/폐기 없이 편집창을 벗어난 초안은 지워지지 않아 학기 단위로 계속 쌓입니다. 이만큼 지난
// 초안은 사용자가 "이어쓰기"를 기대할 시점이 아니므로 마운트할 때 정리합니다.
const draftMaxAgeMs = 14 * 24 * 60 * 60 * 1_000;

export type PostDraftValue = {
  title: string;
  body: string;
};

type StoredPostDraft = {
  version: typeof draftVersion;
  savedAt: string;
  value: PostDraftValue;
};

function storageKey(scope: string) {
  return `${draftKeyPrefix}v${draftVersion}:${scope}`;
}

function legacyStorageKey(scope: string) {
  return `${legacyDraftKeyPrefix}v${draftVersion}:${scope}`;
}

// 만료된 초안과 이전 버전 형식의 초안을 함께 걷어냅니다. 실패해도(사파리 프라이빗 모드 등)
// 초안 기능 자체는 계속 동작해야 하므로 조용히 넘어갑니다.
function pruneStaleDrafts(keepKey: string) {
  try {
    const expiredBefore = Date.now() - draftMaxAgeMs;
    const removable: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || (!key.startsWith(draftKeyPrefix) && !key.startsWith(legacyDraftKeyPrefix)) || key === keepKey) continue;
      if (!key.startsWith(`${draftKeyPrefix}v${draftVersion}:`) && !key.startsWith(`${legacyDraftKeyPrefix}v${draftVersion}:`)) {
        removable.push(key);
        continue;
      }
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      let savedAt: number;
      try {
        savedAt = new Date((JSON.parse(raw) as Partial<StoredPostDraft>).savedAt ?? 0).getTime();
      } catch {
        removable.push(key);
        continue;
      }
      if (!Number.isFinite(savedAt) || savedAt < expiredBefore) removable.push(key);
    }
    for (const key of removable) localStorage.removeItem(key);
  } catch {
    // 저장 공간을 읽을 수 없는 브라우저에서는 정리를 건너뜁니다.
  }
}

function readDraft(scope: string): StoredPostDraft | null {
  try {
    const key = storageKey(scope);
    const legacyKey = legacyStorageKey(scope);
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPostDraft>;
    if (
      parsed.version !== draftVersion
      || !parsed.value
      || typeof parsed.value.title !== "string"
      || typeof parsed.value.body !== "string"
      || typeof parsed.savedAt !== "string"
    ) {
      localStorage.removeItem(key);
      localStorage.removeItem(legacyKey);
      return null;
    }
    // 리브랜딩 전 저장된 초안은 읽는 즉시 새 키로 옮겨 사용자의 작성 중 내용을 보존합니다.
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, raw);
      localStorage.removeItem(legacyKey);
    }
    return parsed as StoredPostDraft;
  } catch {
    return null;
  }
}

function writeDraft(scope: string, value: PostDraftValue) {
  const draft: StoredPostDraft = {
    version: draftVersion,
    savedAt: new Date().toISOString(),
    value,
  };
  localStorage.setItem(storageKey(scope), JSON.stringify(draft));
  return draft.savedAt;
}

function removeDraft(scope: string) {
  try {
    localStorage.removeItem(storageKey(scope));
    localStorage.removeItem(legacyStorageKey(scope));
  } catch {
    // 저장 공간을 사용할 수 없는 브라우저에서도 작성 자체는 계속 허용합니다.
  }
}

export function usePostDraft({
  scope,
  initialTitle = "",
  initialBody = "",
  enabled = true,
}: {
  scope: string;
  initialTitle?: string;
  initialBody?: string;
  enabled?: boolean;
}) {
  const initialValue = useMemo(
    () => ({ title: initialTitle, body: initialBody }),
    [initialBody, initialTitle],
  );
  const [value, setValue] = useState<PostDraftValue>(initialValue);
  const [baseline, setBaseline] = useState<PostDraftValue>(initialValue);
  const [availableDraft, setAvailableDraft] = useState<StoredPostDraft | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [ready, setReady] = useState(false);
  const dirty = value.title !== baseline.title || value.body !== baseline.body;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setValue(initialValue);
      setBaseline(initialValue);
      setLastSavedAt(null);
      setStorageError(false);
      const stored = enabled ? readDraft(scope) : null;
      setAvailableDraft(stored);
      setReady(true);
      // 지금 쓰는 초안은 남기고 오래된 것만 정리해, 쿼터가 차서 자동저장이 멈추는 걸 막습니다.
      pruneStaleDrafts(storageKey(scope));
    });
    return () => {
      active = false;
    };
  }, [enabled, initialValue, scope]);

  useEffect(() => {
    if (!enabled || !ready || !dirty) return;
    const timeout = window.setTimeout(() => {
      try {
        setLastSavedAt(writeDraft(scope, value));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }, autosaveDelayMs);
    return () => window.clearTimeout(timeout);
  }, [dirty, enabled, ready, scope, value]);

  useEffect(() => {
    if (!enabled || !dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty, enabled]);

  const restoreDraft = useCallback(() => {
    if (!availableDraft) return;
    setValue(availableDraft.value);
    setLastSavedAt(availableDraft.savedAt);
    setAvailableDraft(null);
  }, [availableDraft]);

  const discardDraft = useCallback(() => {
    removeDraft(scope);
    setAvailableDraft(null);
    setLastSavedAt(null);
  }, [scope]);

  const markSaved = useCallback(() => {
    removeDraft(scope);
    setBaseline(value);
    setAvailableDraft(null);
    setLastSavedAt(null);
  }, [scope, value]);

  const reset = useCallback(() => {
    removeDraft(scope);
    setValue(initialValue);
    setBaseline(initialValue);
    setAvailableDraft(null);
    setLastSavedAt(null);
    setStorageError(false);
  }, [initialValue, scope]);

  return {
    value,
    setValue,
    dirty,
    availableDraft,
    lastSavedAt,
    storageError,
    restoreDraft,
    discardDraft,
    markSaved,
    reset,
  };
}
