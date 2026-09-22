import "server-only";

import { randomUUID } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import KakaoProvider, { type KakaoProfile } from "next-auth/providers/kakao";
import CredentialsProvider from "next-auth/providers/credentials";
import { credentialLoginSchema } from "@/lib/auth/credentials";
import { legacyRosterInitialPassword } from "@/lib/auth/legacy-roster-password";
import { hashUserPassword, verifyUserPassword } from "@/lib/auth/password";
import {
  prepareCredentialAttempt,
  recordCredentialFailure,
  recordCredentialSuccess,
} from "@/lib/auth/security";
import { getPrisma } from "@/lib/prisma";
import {
  createLoginIdentifierLookup,
  encryptUserLoginIdentifier,
  encryptOptionalUserPii,
  decryptOptionalUserPii,
  normalizeEmail,
} from "@/lib/security/pii-crypto";
import { trustedClientIdentifier } from "@/lib/security/client-ip";
import { notifyRegistrationApprovalRequested } from "@/lib/users/registration-approvals";
import { resolveKakaoProfileImage } from "@/lib/users/kakao-profile-image";
import { signupConsentData } from "@/lib/auth/signup-consent";
import { readSignupConsent, signupConsentRedirect } from "@/lib/auth/signup-consent-cookie";

function isVerifiedKakaoProfile(profile: KakaoProfile | undefined) {
  return profile?.kakao_account?.is_email_valid === true
    && profile.kakao_account.is_email_verified === true;
}

function onboardingState(user: {
  registrationApprovalStatus: "PENDING" | "APPROVED" | "REJECTED";
  onboardingCompletedAt: Date | null;
  teacherApprovalRequest: { status: "PENDING" | "APPROVED" | "REJECTED" } | null;
}) {
  if (user.registrationApprovalStatus === "PENDING") return "ACCOUNT_PENDING" as const;
  if (user.registrationApprovalStatus === "REJECTED") return "ACCOUNT_REJECTED" as const;
  if (user.onboardingCompletedAt) return "COMPLETE" as const;
  if (user.teacherApprovalRequest?.status === "PENDING") return "TEACHER_PENDING" as const;
  return "PROFILE" as const;
}

async function findUserByKakaoEmail(email: string) {
  return getPrisma().user.findUnique({
    where: { loginIdentifierLookup: createLoginIdentifierLookup(email) },
    select: { id: true, status: true, authVersion: true },
  });
}

async function findCredentialSessionUser(userId: string) {
  return getPrisma().user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      authVersion: true,
      mustChangePassword: true,
      registrationApprovalStatus: true,
      onboardingCompletedAt: true,
      teacherApprovalRequest: { select: { status: true } },
    },
  });
}

async function syncKakaoUser(user: { email?: string | null; name?: string | null; image?: string | null }) {
  if (!user.email) throw new Error("카카오 이메일이 필요합니다.");
  const email = normalizeEmail(user.email);
  const loginIdentifierLookup = createLoginIdentifierLookup(email);
  const name = user.name?.trim().slice(0, 60) || null;
  const prisma = getPrisma();
  const existing = await prisma.user.findUnique({ where: { loginIdentifierLookup }, select: { id: true } });
  const now = new Date();

  if (existing) {
    // 최초 로그인 이후의 닉네임·프로필 사진은 사용자가 /api/me에서 직접 관리하므로,
    // 재로그인 때 카카오 프로필로 덮어쓰지 않습니다(이메일만 신원 확인용으로 갱신).
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        loginIdentifierEncrypted: encryptUserLoginIdentifier(existing.id, email),
        lastLoginAt: now,
      },
      select: {
        id: true,
        status: true,
        authVersion: true,
        mustChangePassword: true,
        registrationApprovalStatus: true,
        onboardingCompletedAt: true,
        teacherApprovalRequest: { select: { status: true } },
      },
    });
  }

  const consentAt = await readSignupConsent();
  if (!consentAt) throw new Error("회원가입 동의가 필요합니다. 가입 화면에서 다시 확인해 주세요.");
  const image = await resolveKakaoProfileImage(user.image);
  const id = randomUUID();
  const bootstrapEmail = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL
    ? normalizeEmail(process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL)
    : null;
  const role = bootstrapEmail === email ? "SUPER_ADMIN" : "STUDENT";
  const created = await prisma.user.create({
    data: {
      id,
      loginIdentifierLookup,
      loginIdentifierEncrypted: encryptUserLoginIdentifier(id, email),
      nameEncrypted: encryptOptionalUserPii(id, "name", name),
      imageEncrypted: encryptOptionalUserPii(id, "image", image),
      role,
      registrationApprovalStatus: role === "SUPER_ADMIN" ? "APPROVED" : "PENDING",
      lastLoginAt: now,
      ...signupConsentData(consentAt),
    },
    select: {
      id: true,
      status: true,
      authVersion: true,
      mustChangePassword: true,
      registrationApprovalStatus: true,
      onboardingCompletedAt: true,
      teacherApprovalRequest: { select: { status: true } },
    },
  });
  if (role !== "SUPER_ADMIN") {
    await notifyRegistrationApprovalRequested(created.id)
      .catch((error) => console.error("카카오 가입 승인 알림 생성 실패", error));
  }
  return created;
}

function clearTokenProfile(token: Record<string, unknown>) {
  delete token.email;
  delete token.name;
  delete token.picture;
  delete token.sub;
}

export const authOptions = {
  secret: process.env.AUTH_SECRET,
  pages: {
    signIn: "/",
    error: "/",
  },
  providers: [
    CredentialsProvider({
      name: "아이디",
      credentials: {
        loginId: { label: "아이디", type: "text" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials, request) {
        const parsed = credentialLoginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const loginIdentifierLookup = createLoginIdentifierLookup(parsed.data.loginId);
        const attempt = await prepareCredentialAttempt(
          trustedClientIdentifier(request.headers),
          loginIdentifierLookup,
        );
        if (!attempt.allowed) return null;

        const user = await getPrisma().user.findUnique({
          where: { loginIdentifierLookup },
          select: {
            id: true,
            passwordHash: true,
            status: true,
            mustChangePassword: true,
            nameEncrypted: true,
          },
        });
        let passwordMatches = await verifyUserPassword(parsed.data.password, user?.passwordHash);
        let repairedLegacyPassword = false;
        if (user && !passwordMatches && user.mustChangePassword && parsed.data.password === parsed.data.loginId) {
          const name = decryptOptionalUserPii(user.id, "name", user.nameEncrypted);
          const legacyPassword = name ? legacyRosterInitialPassword(name, parsed.data.loginId) : null;
          if (legacyPassword) {
            passwordMatches = await verifyUserPassword(legacyPassword, user.passwordHash);
            repairedLegacyPassword = passwordMatches;
          }
        }
        if (!user || user.status !== "ACTIVE" || !passwordMatches) {
          await recordCredentialFailure(attempt);
          return null;
        }

        await Promise.all([
          getPrisma().user.update({
            where: { id: user.id },
            data: {
              lastLoginAt: new Date(),
              ...(repairedLegacyPassword ? { passwordHash: await hashUserPassword(parsed.data.loginId) } : {}),
            },
            select: { id: true },
          }),
          recordCredentialSuccess(attempt, loginIdentifierLookup, user.id),
        ]);
        return { id: user.id };
      },
    }),
    KakaoProvider({
      clientId: process.env.KAKAO_CLIENT_ID ?? "",
      clientSecret: process.env.KAKAO_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          scope: "profile_nickname profile_image account_email",
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "credentials") return Boolean(user.id);
      if (account?.provider !== "kakao" || !user.email) return false;
      if (!isVerifiedKakaoProfile(profile as KakaoProfile | undefined)) return false;
      const existing = await findUserByKakaoEmail(user.email);
      if (existing) return existing.status === "ACTIVE";
      return (await readSignupConsent()) ? true : await signupConsentRedirect();
    },
    async jwt({ token, user, account }) {
      let userId = typeof token.userId === "string" ? token.userId : null;
      let authVersion = typeof token.authVersion === "number" ? token.authVersion : null;
      let onboardingCompleted = typeof token.onboardingCompleted === "boolean" ? token.onboardingCompleted : undefined;
      let currentOnboardingState = token.onboardingState;
      let passwordChangeRequired = typeof token.passwordChangeRequired === "boolean" ? token.passwordChangeRequired : undefined;

      if (user && account?.provider === "kakao" && user.email) {
        const dbUser = await syncKakaoUser(user);
        if (dbUser.status === "ACTIVE") {
          userId = dbUser.id;
          authVersion = dbUser.authVersion;
          onboardingCompleted = dbUser.onboardingCompletedAt !== null;
          currentOnboardingState = onboardingState(dbUser);
          passwordChangeRequired = dbUser.mustChangePassword;
        } else {
          userId = null;
          authVersion = null;
          onboardingCompleted = undefined;
          currentOnboardingState = undefined;
          passwordChangeRequired = undefined;
        }
      } else if (user && account?.provider === "credentials" && user.id) {
        const dbUser = await findCredentialSessionUser(user.id);
        if (dbUser?.status === "ACTIVE") {
          userId = dbUser.id;
          authVersion = dbUser.authVersion;
          onboardingCompleted = dbUser.onboardingCompletedAt !== null;
          currentOnboardingState = onboardingState(dbUser);
          passwordChangeRequired = dbUser.mustChangePassword;
        } else {
          userId = null;
          authVersion = null;
          onboardingCompleted = undefined;
          currentOnboardingState = undefined;
          passwordChangeRequired = undefined;
        }
      } else if (userId && authVersion !== null) {
        const current = await getPrisma().user.findUnique({
          where: { id: userId },
          select: {
            status: true,
            authVersion: true,
            mustChangePassword: true,
            registrationApprovalStatus: true,
            onboardingCompletedAt: true,
            teacherApprovalRequest: { select: { status: true } },
          },
        });
        if (!current || current.status !== "ACTIVE" || current.authVersion !== authVersion) {
          userId = null;
          authVersion = null;
          onboardingCompleted = undefined;
          currentOnboardingState = undefined;
          passwordChangeRequired = undefined;
        } else {
          onboardingCompleted = current.onboardingCompletedAt !== null;
          currentOnboardingState = onboardingState(current);
          passwordChangeRequired = current.mustChangePassword;
        }
      } else {
        userId = null;
        authVersion = null;
        onboardingCompleted = undefined;
        currentOnboardingState = undefined;
        passwordChangeRequired = undefined;
      }

      token.userId = userId ?? undefined;
      token.authVersion = authVersion ?? undefined;
      token.onboardingCompleted = onboardingCompleted;
      token.onboardingState = currentOnboardingState;
      token.passwordChangeRequired = passwordChangeRequired;
      token.sessionInvalid = !userId;
      clearTokenProfile(token);
      return token;
    },
    async session({ session, token }) {
      session.user = {
        id: typeof token.userId === "string" && token.sessionInvalid !== true ? token.userId : undefined,
        onboardingCompleted: token.onboardingCompleted,
        onboardingState: token.onboardingState,
        passwordChangeRequired: token.passwordChangeRequired,
        name: null,
        email: null,
        image: null,
      };
      return session;
    },
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  jwt: {
    maxAge: 60 * 60 * 24 * 7,
  },
} satisfies NextAuthOptions;
