"use client";

import { useState, type FormEvent } from "react";
import { LoaderCircle, Save } from "lucide-react";
import styles from "@/components/pad/attachments/attachment-metadata-editor.module.css";
import type {
  AttachmentMetadataInput,
  AttachmentViewData,
} from "@/components/pad/attachments/types";

function optionalText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

export function AttachmentMetadataEditor({
  attachment,
  onCancel,
  onSave,
}: {
  attachment: AttachmentViewData;
  onCancel: () => void;
  onSave: (value: AttachmentMetadataInput) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value: AttachmentMetadataInput = {
      altText: attachment.type === "IMAGE"
        ? optionalText(data.get("altText"))
        : attachment.altText ?? null,
      caption: optionalText(data.get("caption")),
    };
    setSaving(true);
    setError("");
    try {
      await onSave(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "첨부 설명을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      {attachment.type === "IMAGE" && (
        <label>
          대체텍스트
          <textarea
            name="altText"
            defaultValue={attachment.altText ?? ""}
            maxLength={300}
            rows={2}
            disabled={saving}
            placeholder="이미지를 볼 수 없는 사람에게 전달할 내용을 적어주세요."
          />
          <small>장식용 이미지라면 비워둘 수 있습니다.</small>
        </label>
      )}
      <label>
        첨부 캡션
        <textarea
          name="caption"
          defaultValue={attachment.caption ?? ""}
          maxLength={500}
          rows={2}
          disabled={saving}
          placeholder="자료의 출처나 설명을 적어주세요."
        />
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer>
        <button type="button" className="button ghost" disabled={saving} onClick={onCancel}>취소</button>
        <button className="button primary" disabled={saving}>
          {saving ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
          설명 저장
        </button>
      </footer>
    </form>
  );
}
