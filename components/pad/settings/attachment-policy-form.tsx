"use client";

import { Ban, Globe, ShieldCheck, Users } from "lucide-react";
import styles from "@/components/pad/settings/settings.module.css";
import { OptionPicker } from "@/components/pad/settings/option-picker";
import type { AttachmentDownloadPolicy } from "@/components/pad/attachments/types";

export function AttachmentPolicyForm({
  value,
  onChange,
}: {
  value: AttachmentDownloadPolicy;
  onChange: (value: AttachmentDownloadPolicy) => void;
}) {
  return (
    <fieldset className={styles.group}>
      <legend>첨부 다운로드</legend>
      <OptionPicker
        name="attachmentDownloadPolicy"
        value={value}
        onChange={onChange}
        options={[
          { value: "READERS", label: "패드 열람자", icon: <Globe size={18} />, description: "패드를 읽을 수 있는 사람은 원본 파일을 내려받을 수 있습니다." },
          { value: "MEMBERS", label: "가입 멤버", icon: <Users size={18} />, description: "패드에 가입된 멤버만 원본 파일을 내려받을 수 있습니다." },
          { value: "EDITORS", label: "작성자·편집자·관리자", icon: <ShieldCheck size={18} />, description: "게시물 작성자와 패드 편집·관리 권한이 있는 사람만 내려받을 수 있습니다." },
          { value: "DISABLED", label: "다운로드 사용 안 함", icon: <Ban size={18} />, description: "다운로드 버튼과 download=1 요청을 막고 인라인 미리보기만 제공합니다." },
        ]}
      />
      <p className={styles.note}>이 설정은 화면의 버튼뿐 아니라 파일 Route Handler와 전체 첨부 ZIP에서도 다시 검사해야 합니다. 인라인으로 전달된 이미지·음성·영상·PDF의 복사까지 기술적으로 완전히 막을 수는 없습니다.</p>
    </fieldset>
  );
}
