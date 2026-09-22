"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { LegalDocument } from "@/components/auth/legal-document";
import type { SignupConsent } from "@/lib/legal/constants";

export function SignupConsentFields({ value, onChange, disabled }: { value: SignupConsent; onChange: (value: SignupConsent) => void; disabled: boolean }) {
  const [document, setDocument] = useState<"terms" | "privacy" | null>(null);
  return <>
    <fieldset className="signup-consent" disabled={disabled}>
      <legend>가입 동의</legend>
      <div><label><input type="checkbox" checked={value.terms} onChange={event => onChange({ ...value, terms: event.target.checked })} /><span>[필수] 이용약관에 동의합니다.</span></label><button type="button" className="text-button" aria-label="이용약관 내용 보기" onClick={() => setDocument("terms")}>보기</button></div>
      <div><label><input type="checkbox" checked={value.privacy} onChange={event => onChange({ ...value, privacy: event.target.checked })} /><span>[필수] 개인정보 수집·이용에 동의합니다.</span></label><button type="button" className="text-button" aria-label="개인정보 수집·이용 내용 보기" onClick={() => setDocument("privacy")}>보기</button></div>
      <div><label><input type="checkbox" checked={value.age14} onChange={event => onChange({ ...value, age14: event.target.checked })} /><span>[필수] 만 14세 이상입니다.</span></label></div>
      <p>회원 식별·수업 제공을 위해 아이디 또는 카카오 이메일 등을 처리합니다. 가입·프로필 정보는 탈퇴 시까지 이용하며, 학습 기록 등 예외는 처리방침에서 확인해 주세요. 동의를 거부할 수 있으나 필수 동의 없이는 가입할 수 없습니다.</p>
    </fieldset>
    <Modal open={document !== null} onClose={() => setDocument(null)} title={document === "terms" ? "이용약관" : "개인정보 처리방침"}>
      {document && <LegalDocument kind={document} />}
    </Modal>
  </>;
}
