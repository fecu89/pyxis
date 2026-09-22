import "server-only";

import { z } from "zod";
import { normalizeLoginIdentifier } from "@/lib/security/pii-crypto";
import { signupConsentSchema } from "@/lib/auth/signup-consent";

export const credentialLoginIdValueSchema = z.string()
  .trim()
  .min(3, "아이디는 3자 이상 입력해 주세요.")
  .max(20, "아이디는 20자 이하로 입력해 주세요.")
  .transform(normalizeLoginIdentifier)
  .refine(
    (value) => /^[a-z0-9]+$/u.test(value),
    "아이디는 영문자와 숫자만 사용할 수 있습니다.",
  );

const loginPasswordSchema = z.string()
  .min(1, "비밀번호를 입력해 주세요.")
  .max(128, "비밀번호는 128자 이하로 입력해 주세요.");

const commonPasswords = new Set([
  "password1!",
  "password123!",
  "qwerty123!",
  "welcome123!",
  "admin123!",
  "p@ssw0rd1",
  "abcd1234!",
  "aa123456!",
  "pyxpad123!",
  "pyxcourse123!",
]);

const registrationPasswordSchema = z.string()
  .min(10, "비밀번호는 10자 이상 입력해 주세요.")
  .max(128, "비밀번호는 128자 이하로 입력해 주세요.")
  .refine((value) => /[A-Za-z]/u.test(value), "비밀번호에 영문자를 포함해 주세요.")
  .refine((value) => /[0-9]/u.test(value), "비밀번호에 숫자를 포함해 주세요.")
  .refine((value) => /[^A-Za-z0-9\s]/u.test(value), "비밀번호에 특수문자를 포함해 주세요.")
  .refine((value) => !commonPasswords.has(value.toLocaleLowerCase("en-US")), "너무 흔한 비밀번호는 사용할 수 없습니다.");

export const credentialLoginSchema = z.object({
  loginId: credentialLoginIdValueSchema,
  password: loginPasswordSchema,
});

export const credentialLoginIdSchema = z.object({ loginId: credentialLoginIdValueSchema });

export const credentialRegisterSchema = z.object({
  consent: signupConsentSchema,
  loginId: credentialLoginIdValueSchema,
  password: registrationPasswordSchema,
  passwordConfirm: registrationPasswordSchema,
}).superRefine((value, context) => {
  if (value.password !== value.passwordConfirm) {
    context.addIssue({ code: "custom", path: ["passwordConfirm"], message: "비밀번호 확인이 일치하지 않습니다." });
  }
  if (value.loginId.length >= 4 && value.password.toLocaleLowerCase("en-US").includes(value.loginId)) {
    context.addIssue({ code: "custom", path: ["password"], message: "비밀번호에 로그인 아이디를 포함할 수 없습니다." });
  }
});

export const credentialPasswordChangeSchema = z.object({
  loginId: credentialLoginIdValueSchema,
  password: registrationPasswordSchema,
  passwordConfirm: registrationPasswordSchema,
}).superRefine((value, context) => {
  if (value.password !== value.passwordConfirm) {
    context.addIssue({ code: "custom", path: ["passwordConfirm"], message: "비밀번호 확인이 일치하지 않습니다." });
  }
  if (value.loginId.length >= 4 && value.password.toLocaleLowerCase("en-US").includes(value.loginId)) {
    context.addIssue({ code: "custom", path: ["password"], message: "비밀번호에 로그인 아이디를 포함할 수 없습니다." });
  }
});
