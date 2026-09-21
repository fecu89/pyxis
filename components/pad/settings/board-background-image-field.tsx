"use client";
/* eslint-disable @next/next/no-img-element */

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { cachedUploadPolicy, fetchUploadPolicy } from "@/lib/files/upload-policy-client";
import { mb } from "@/lib/files/upload-policy-shape";
import { ImagePlus, LoaderCircle, Trash2, Upload } from "lucide-react";
import { useConfirm } from "@/components/ui/app-dialog";
import styles from "@/components/pad/settings/settings.module.css";



export function BoardBackgroundImageField({
  boardId,
  value,
  onChange,
}: {
  boardId: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const [busy, setBusy] = useState<"upload" | "delete" | null>(null);
  const [error, setError] = useState("");

  // 배경 상한은 관리 페이지에서 바뀔 수 있어 서버에서 받아 옵니다. 예전에는 이 파일과 서버
  // 라우트에 10MB가 각각 박혀 있어 한쪽만 고치면 안내와 판정이 갈라졌습니다.
  useEffect(() => {
    void fetchUploadPolicy();
  }, []);

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    if (file.size > mb(cachedUploadPolicy().maxBoardBackgroundMb)) {
      setError("배경 이미지는 10MB 이하만 올릴 수 있어요.");
      return;
    }
    setBusy("upload");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/boards/${boardId}/background-image`, { method: "POST", body });
      const result = await response.json() as { backgroundImageUrl?: string; error?: string };
      if (!response.ok || !result.backgroundImageUrl) {
        throw new Error(result.error || "배경 이미지를 올리지 못했습니다.");
      }
      onChange(result.backgroundImageUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "배경 이미지를 올리지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function removeImage() {
    if (!value) return;
    if (!(await confirm("패드 배경 이미지를 삭제할까요?"))) return;
    setBusy("delete");
    setError("");
    try {
      const response = await fetch(`/api/boards/${boardId}/background-image`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "배경 이미지를 삭제하지 못했습니다.");
      onChange(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "배경 이미지를 삭제하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <fieldset className={styles.group}>
      <legend>배경 이미지</legend>
      <div className={styles.backgroundPreview} data-empty={!value}>
        {value
          ? <img src={value} alt="현재 패드 배경 미리보기" />
          : (
            <div className={styles.backgroundPlaceholder}>
              <span><ImagePlus size={24} aria-hidden /></span>
              <b>패드에 분위기를 더해 보세요</b>
              <small>지정한 이미지는 패드 배경과 홈 카드 커버에 함께 사용됩니다.</small>
            </div>
          )}
        {value && <span className={styles.backgroundFormatBadge}>WebP 자동 최적화</span>}
      </div>
      <div className={styles.backgroundActions}>
        <input
          ref={inputRef}
          className={styles.hiddenFileInput}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          onChange={selectImage}
        />
        <button type="button" className="button soft" disabled={busy !== null} onClick={() => inputRef.current?.click()}>
          {busy === "upload" ? <LoaderCircle size={15} className="spin" aria-hidden /> : <Upload size={15} aria-hidden />}
          {value ? "이미지 교체" : "이미지 선택"}
        </button>
        {value && (
          <button type="button" className={styles.backgroundDelete} disabled={busy !== null} onClick={() => void removeImage()}>
            {busy === "delete" ? <LoaderCircle size={15} className="spin" aria-hidden /> : <Trash2 size={15} aria-hidden />}
            삭제
          </button>
        )}
      </div>
      <p className={styles.note}>JPG·PNG·WebP, 최대 10MB · 업로드하면 최대 1920×1200 WebP로 안전하게 변환합니다.</p>
      {error && <p className={styles.fieldError} role="alert">{error}</p>}
    </fieldset>
  );
}
