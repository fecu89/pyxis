import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      onboardingCompleted?: boolean;
      onboardingState?: "ACCOUNT_PENDING" | "ACCOUNT_REJECTED" | "PROFILE" | "TEACHER_PENDING" | "COMPLETE";
      passwordChangeRequired?: boolean;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    authVersion?: number;
    sessionInvalid?: boolean;
    onboardingCompleted?: boolean;
    onboardingState?: "ACCOUNT_PENDING" | "ACCOUNT_REJECTED" | "PROFILE" | "TEACHER_PENDING" | "COMPLETE";
    passwordChangeRequired?: boolean;
  }
}
