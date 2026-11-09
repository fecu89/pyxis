// NextAuth `?error=` 코드를 화면 문구로 바꿉니다. 커스텀 코드는 `auth-options.ts`의 signIn 콜백이 보냅니다.
const MESSAGES: Record<string, string> = {
  KakaoEmailMissing: "카카오에서 이메일을 받지 못했습니다. 카카오 동의 화면에서 '카카오계정(이메일)' 항목을 체크했는지 확인해 주세요.",
  KakaoEmailUnverified: "카카오 계정의 이메일이 인증되지 않았습니다. 카카오 계정 설정에서 이메일 인증 후 다시 시도해 주세요.",
  AccountInactive: "이 카카오 계정으로 가입된 계정이 정지 상태입니다. 관리자에게 문의해 주세요.",
  AccessDenied: "카카오 로그인이 거부되었습니다. 잠시 후 다시 시도해 주세요.",
};

export function authErrorMessage(error: string | undefined) {
  if (!error) return null;
  return MESSAGES[error] ?? "카카오 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}
