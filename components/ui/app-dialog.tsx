"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// Provider와 hook은 모든 화면에서 쓰지만 모달 표면·포커스 트랩은 실제 대화상자를 열기 전에는
// 필요 없습니다. 별도 청크로 미뤄 첫 화면의 공용 클라이언트 번들을 줄입니다.
const ConfirmDialog = dynamic(() => import("@/components/ui/app-dialog-surface").then((module) => module.ConfirmDialogSurface));
const PromptDialog = dynamic(() => import("@/components/ui/app-dialog-surface").then((module) => module.PromptDialogSurface));

// window.confirm / window.prompt를 대체하는 앱 자체 대화상자입니다. Promise를 돌려주므로
// 호출부는 `if (!(await confirm("..."))) return;`처럼 기존 코드와 거의 같은 모양으로 씁니다.
//
// 병합 전에는 pad의 `ConfirmProvider`(confirm만)와 quiz의 `DialogProvider`(confirm + promptText)가
// 각자 모달을 그리며 루트에 함께 걸려 있었습니다. 확인창 하나에 구현이 둘이면 스타일이 갈리고,
// 실제로 버튼 높이와 굵기가 서로 달랐습니다. 구현은 여기 하나로 모으고 pad의 `Modal`을 씁니다
// (포커스 트랩·스크롤 잠금·Esc 처리가 이미 들어 있고 앱의 다른 모달과 같은 껍데기가 됩니다).
//
// 호출부는 그대로 둡니다 — `useConfirm()`은 confirm 함수를, `useDialog()`는 `{confirm, promptText}`를
// 돌려주므로 양쪽에서 이식한 25개 파일을 건드릴 필요가 없습니다.

export type ConfirmOptions = {
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true면 확인 버튼이 danger 스타일로 뜹니다 — 되돌릴 수 없는 삭제류에 씁니다. */
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  maxLength?: number;
  inputMode?: "text" | "numeric";
  confirmLabel?: string;
  /** 오류 문구를 돌려주면 제출을 막고 인라인으로 보여줍니다. */
  validate?: (value: string) => string | null;
};

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;
type PromptFn = (options: PromptOptions) => Promise<string | null>;

type Pending =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

type DialogApi = { confirm: ConfirmFn; promptText: PromptFn };

const DialogContext = createContext<DialogApi | null>(null);

export function AppDialogProvider({ children }: { children: ReactNode }) {
  // 큐로 두는 이유: 확인창 안에서 또 확인을 부르는 흐름(예: 삭제 확인 → 사유 입력)이 있어
  // 하나를 상태로 들고 있으면 뒤엣것이 앞엣것을 덮어써 앞의 Promise가 영원히 걸립니다.
  const [queue, setQueue] = useState<Pending[]>([]);
  const queueRef = useRef(queue);
  const current = queue[0] ?? null;
  const close = useCallback(() => setQueue((entries) => {
    const next = entries.slice(1);
    queueRef.current = next;
    return next;
  }), []);

  const confirm = useCallback<ConfirmFn>((options) => {
    const normalized: ConfirmOptions = typeof options === "string" ? { description: options } : options;
    return new Promise<boolean>((resolve) => {
      setQueue((entries) => {
        const next: Pending[] = [...entries, { kind: "confirm", options: normalized, resolve }];
        queueRef.current = next;
        return next;
      });
    });
  }, []);

  const promptText = useCallback<PromptFn>((options) => {
    return new Promise<string | null>((resolve) => {
      setQueue((entries) => {
        const next: Pending[] = [...entries, { kind: "prompt", options, resolve }];
        queueRef.current = next;
        return next;
      });
    });
  }, []);
  const value = useMemo<DialogApi>(() => ({ confirm, promptText }), [confirm, promptText]);

  useEffect(() => () => {
    // 앱이 내려갈 때 열린 Promise가 호출부 클로저를 계속 붙잡지 않게 모두 취소로 끝냅니다.
    for (const pending of queueRef.current) {
      if (pending.kind === "confirm") pending.resolve(false);
      else pending.resolve(null);
    }
    queueRef.current = [];
  }, []);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {current?.kind === "confirm" && (
        <ConfirmDialog
          key={queue.length}
          options={current.options}
          onDone={(ok) => { current.resolve(ok); close(); }}
        />
      )}
      {current?.kind === "prompt" && (
        <PromptDialog
          key={queue.length}
          options={current.options}
          onDone={(value) => { current.resolve(value); close(); }}
        />
      )}
    </DialogContext.Provider>
  );
}

/** 확인창만 필요할 때. `await confirm("지울까요?")` 또는 `await confirm({ description, danger: true })`. */
export function useConfirm(): ConfirmFn {
  const api = useContext(DialogContext);
  if (!api) throw new Error("useConfirm은 AppDialogProvider 안에서만 쓸 수 있습니다.");
  return api.confirm;
}

/** 확인창과 입력창을 함께 쓸 때. `dialog.confirm({...})`, `dialog.promptText({...})`. */
export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error("useDialog는 AppDialogProvider 안에서만 쓸 수 있습니다.");
  return api;
}
