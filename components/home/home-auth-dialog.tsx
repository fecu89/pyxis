"use client";

import { AuthForm } from "@/components/auth/auth-form";
import { Modal } from "@/components/ui/modal";
import { APP_NAME } from "@/lib/brand";

/** 공개 랜딩에서 로그인 버튼을 눌렀을 때만 내려받는 모달 표면입니다. */
export function HomeAuthDialog({ callbackUrl, initialError, onClose }: {
  callbackUrl: string;
  initialError: string | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`${APP_NAME} 시작하기`}
      description="아이디 계정을 만들거나 카카오로 계속할 수 있어요."
      className="auth-modal"
    >
      <AuthForm callbackUrl={callbackUrl} initialError={initialError} />
    </Modal>
  );
}
