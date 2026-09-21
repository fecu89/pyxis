"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type DragEvent } from "react";
import { Paperclip } from "lucide-react";
import {
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  Editor,
  rootCtx,
} from "@milkdown/core";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { commonmark } from "@milkdown/preset-commonmark";
import { Selection } from "@milkdown/prose/state";
import { getMarkdown, insert, replaceAll } from "@milkdown/utils";
import "@milkdown/prose/view/style/prosemirror.css";

type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  onFilesDrop?: (files: File[]) => void;
  placeholder?: string;
  required?: boolean;
};

export type MarkdownEditorHandle = {
  insertBlock: (markdown: string) => void;
  getMarkdown: () => string;
};

function carriesFiles(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({ value, onChange, onFilesDrop, placeholder, required = false }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const initialValueRef = useRef(value);
  const editorValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const pendingInsertionsRef = useRef<string[]>([]);
  const fileDragDepthRef = useRef(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [failed, setFailed] = useState(false);
  const [fileDragActive, setFileDragActive] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let active = true;
    const instance = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialValueRef.current);
        ctx.set(editorViewOptionsCtx, {
          attributes: {
            "aria-label": "게시물 내용",
            "aria-multiline": "true",
            "aria-required": String(required),
            spellcheck: "true",
          },
        });
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (markdown === editorValueRef.current) return;
          editorValueRef.current = markdown;
          onChangeRef.current(markdown);
        });
      })
      .use(commonmark)
      .use(history)
      .use(listener);
    const creating = instance.create();
    void creating.then((created) => {
      if (!active) return;
      setEditor(created);
      for (const markdown of pendingInsertionsRef.current.splice(0)) {
        created.action(insert(markdown));
      }
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      void creating.then((created) => created.destroy()).catch(() => undefined);
    };
  }, [required]);

  // 초안 복구·게시물 전환처럼 편집기 바깥에서 본문이 바뀔 때만 문서를 교체합니다. 일반 입력은
  // listener가 만든 값과 같으므로 이 경로를 타지 않아 커서와 실행 취소 기록이 유지됩니다.
  useEffect(() => {
    if (!editor || value === editorValueRef.current) return;
    editorValueRef.current = value;
    editor.action(replaceAll(value));
  }, [editor, value]);

  useImperativeHandle(ref, () => ({
    // listener의 200ms debounce를 기다리지 않고 저장 시점의 문서를 읽습니다.
    getMarkdown() {
      return editor ? editor.action(getMarkdown()) : fallbackRef.current?.value ?? editorValueRef.current;
    },
    insertBlock(markdown: string) {
      if (editor) {
        editor.action(insert(markdown));
        editor.action((ctx) => ctx.get(editorViewCtx).focus());
        return;
      }
      if (!failed) {
        pendingInsertionsRef.current.push(markdown);
        return;
      }
      const textarea = fallbackRef.current;
      const start = textarea?.selectionStart ?? editorValueRef.current.length;
      const end = textarea?.selectionEnd ?? start;
      const before = editorValueRef.current.slice(0, start).replace(/\s*$/, "");
      const after = editorValueRef.current.slice(end).replace(/^\s*/, "");
      const next = [before, markdown, after].filter(Boolean).join("\n\n");
      editorValueRef.current = next;
      onChangeRef.current(next);
      requestAnimationFrame(() => textarea?.focus());
    },
  }), [editor, failed]);

  function handleFileDragEnter(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (!onFilesDrop) return;
    fileDragDepthRef.current += 1;
    setFileDragActive(true);
  }

  function handleFileDragOver(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (!onFilesDrop) return;
    event.dataTransfer.dropEffect = "copy";
    if (!fileDragActive) setFileDragActive(true);
  }

  function handleFileDragLeave(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (!onFilesDrop) return;
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (!fileDragDepthRef.current) setFileDragActive(false);
  }

  function handleFileDrop(event: DragEvent<HTMLElement>) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!onFilesDrop) return;
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    fileDragDepthRef.current = 0;
    setFileDragActive(false);

    // 현재 선택이 아니라 사용자가 놓은 좌표에 첨부 블록을 넣습니다. 문서 여백에 놓으면 가장
    // 가까운 유효 위치를 고르고, 여러 파일은 그 위치부터 차례로 삽입됩니다.
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const droppedAt = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (droppedAt) {
        const selection = Selection.near(view.state.doc.resolve(droppedAt.pos));
        view.dispatch(view.state.tr.setSelection(selection));
      }
      view.focus();
    });
    onFilesDrop(files);
  }

  if (failed) {
    return (
      <textarea
        ref={fallbackRef}
        className="composer-markdown-fallback"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={12}
        maxLength={20_000}
        required={required}
        onDragEnter={handleFileDragEnter}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
      />
    );
  }

  return (
    <div
      className="composer-markdown-editor"
      data-empty={!value.trim()}
      data-loading={!editor}
      data-file-dragging={fileDragActive || undefined}
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      <div ref={rootRef} />
      {!value.trim() && placeholder ? <span className="composer-markdown-placeholder" aria-hidden>{placeholder}</span> : null}
      {fileDragActive ? <span className="composer-markdown-drop-overlay" aria-hidden><Paperclip size={22} />파일 놓기</span> : null}
    </div>
  );
});
