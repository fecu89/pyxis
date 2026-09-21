"use client";

import { useState } from "react";
import { LoaderCircle, Save, X } from "lucide-react";
import type { AttachmentMetadataInput, AttachmentViewData } from "@/components/pad/attachments/types";
import styles from "@/components/pad/composer/composer-attachment-metadata.module.css";

export function ComposerAttachmentMetadata({
  name,
  type,
  value,
  onCancel,
  onSave,
}: {
  name: string;
  type: AttachmentViewData["type"];
  value: AttachmentMetadataInput;
  onCancel: () => void;
  onSave: (value: AttachmentMetadataInput) => void | Promise<void>;
}) {
  const [altText, setAltText] = useState(value.altText ?? "");
  const [caption, setCaption] = useState(value.caption ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave({
        altText: type === "IMAGE" ? altText.trim() || null : value.altText,
        caption: caption.trim() || null,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "첨부 설명을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={styles.panel} aria-label={`${name} 설명 편집`}>
      <header>
        <span><b>{name}</b><small>게시물과 함께 표시할 설명</small></span>
        <button type="button" onClick={onCancel} disabled={saving} aria-label="설명 편집 닫기" title="닫기"><X size={15} /></button>
      </header>
      {type === "IMAGE" && (
        <label>
          대체텍스트
          <textarea value={altText} onChange={(event) => setAltText(event.target.value)} maxLength={300} rows={2} disabled={saving} placeholder="이미지를 볼 수 없는 사람에게 전달할 내용을 적어주세요." />
          <small>장식용 이미지라면 비워둘 수 있습니다.</small>
        </label>
      )}
      <label>
        첨부 캡션
        <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} rows={2} disabled={saving} placeholder="자료의 출처나 설명을 적어주세요." />
      </label>
      {error && <p role="alert">{error}</p>}
      <footer>
        <button type="button" className="button soft" disabled={saving} onClick={onCancel}>취소</button>
        <button type="button" className="button primary" disabled={saving} onClick={() => void save()}>
          {saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
          설명 저장
        </button>
      </footer>
    </section>
  );
}
