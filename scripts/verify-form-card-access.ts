import assert from "node:assert/strict";
import { resolveFormAccessLevel } from "@/lib/forms/access-level";
import type { PermissionHolder } from "@/lib/auth/permissions";

const teacher = { id: "teacher", role: "TEACHER", systemPermissions: [] } satisfies PermissionHolder & { id: string };
const form = { ownerId: "owner", frozenAt: null, shares: [] };

assert.equal(resolveFormAccessLevel(form, teacher), null);
assert.equal(resolveFormAccessLevel({ ...form, ownerId: teacher.id }, teacher), "OWNER");
assert.equal(resolveFormAccessLevel({ ...form, shares: [{ permission: "EDITOR" }] }, teacher), "EDITOR");
assert.equal(resolveFormAccessLevel({ ...form, shares: [{ permission: "VIEWER" }] }, teacher), "VIEWER");
assert.equal(resolveFormAccessLevel({ ...form, ownerId: teacher.id, frozenAt: new Date() }, teacher), "VIEWER");
assert.equal(resolveFormAccessLevel({ ...form, shares: [{ permission: "EDITOR" }], frozenAt: new Date() }, teacher), "VIEWER");
assert.equal(resolveFormAccessLevel(form, { ...teacher, role: "ADMIN" }), null);
assert.equal(resolveFormAccessLevel(form, { ...teacher, role: "ADMIN", systemPermissions: ["VIEW_ALL_QUIZZES"] }), "VIEWER");
assert.equal(resolveFormAccessLevel(form, { ...teacher, role: "ADMIN", systemPermissions: ["EDIT_ANY_QUIZ"] }), "OWNER");
assert.equal(resolveFormAccessLevel({ ...form, frozenAt: new Date() }, { ...teacher, role: "SUPER_ADMIN" }), "OWNER");
assert.equal(resolveFormAccessLevel({ ...form, frozenAt: new Date() }, { ...teacher, role: "ADMIN", systemPermissions: ["EDIT_ANY_QUIZ"] }), "OWNER");
console.log("Forms 목록·API 공용 권한: 소유·공유·관리자·동결 11개 조합 통과");
