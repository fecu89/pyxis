import "server-only";

import { randomUUID } from "node:crypto";
import type { CurrentUser } from "@/lib/auth/current-user";
import { editableAnswers } from "@/lib/forms/editable-answers";
import { formClosedReason } from "@/lib/forms/field-types";
import { hashGuestToken, readGuestTokenFromCookieHeader } from "@/lib/forms/guest-access";
import { getPrisma } from "@/lib/prisma";

const answerSelect = {
  fieldId: true,
  fieldType: true,
  textValue: true,
  selectedOptionIds: true,
  numberValue: true,
  dateValue: true,
  timeValue: true,
  gridValue: true,
  signatureStrokes: true,
  files: { where: { deletedAt: null }, select: { id: true } },
} as const;

export async function loadPublicFormData({
  slug,
  actor,
  cookieHeader,
  responseId,
}: {
  slug: string;
  actor: CurrentUser | null;
  cookieHeader: string | null;
  responseId?: string;
}) {
  const prisma = getPrisma();
  const form = await prisma.form.findUnique({
    where: { slug },
    include: {
      fields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } },
    },
  });
  if (!form || form.deletedAt) return null;

  const closedReason = formClosedReason(form);
  if (closedReason) {
    return {
      form: { id: form.id, title: form.title, description: form.description, status: form.status, requiresLogin: form.requiresLogin },
      closedReason,
      closedMessage: form.closedMessage,
      hasResponded: false,
      canEdit: false,
      shuffleSeed: randomUUID(),
    };
  }

  const respondentId = actor?.id ?? null;
  const guestToken = actor ? null : readGuestTokenFromCookieHeader(cookieHeader, form.id);
  const guestTokenHash = guestToken ? hashGuestToken(guestToken) : null;
  const identity = [
    respondentId ? { respondentId } : undefined,
    guestTokenHash ? { guestTokenHash } : undefined,
  ].filter((clause): clause is NonNullable<typeof clause> => Boolean(clause));

  const existing = identity.length
    ? await prisma.formResponse.findFirst({
        where: { formId: form.id, ...(responseId ? { id: responseId } : {}), OR: identity },
        orderBy: { submittedAt: "desc" },
        select: { id: true, answers: { select: answerSelect } },
      })
    : null;

  let editError: string | null = null;
  let canEdit = Boolean(existing) && form.allowEditAfterSubmit && (Boolean(responseId) || !form.allowMultipleResponses);
  if (responseId && !existing) editError = "응답을 찾을 수 없거나 수정 권한이 없습니다.";
  else if (responseId && !form.allowEditAfterSubmit) editError = "이 설문은 제출 후 수정할 수 없습니다.";
  if (editError) canEdit = false;

  return {
    form: {
      id: form.id,
      slug: form.slug,
      title: form.title,
      description: form.description,
      requiresLogin: form.requiresLogin,
      allowMultipleResponses: form.allowMultipleResponses,
      allowEditAfterSubmit: form.allowEditAfterSubmit,
      shuffleFields: form.shuffleFields,
      showProgressBar: form.showProgressBar,
      confirmationMessage: form.confirmationMessage,
      fields: form.fields.map((field) => ({
        id: field.id,
        type: field.type,
        title: field.title,
        description: field.description,
        required: field.required,
        imageUrl: field.imageUrl,
        imageAlt: field.imageAlt,
        options: field.options.map((option) => ({ id: option.id, text: option.text })),
        shuffleOptions: field.shuffleOptions,
        allowOther: field.allowOther,
        gridRows: field.gridRows,
        gridRequireOneResponsePerRow: field.gridRequireOneResponsePerRow,
        scaleMin: field.scaleMin,
        scaleMax: field.scaleMax,
        scaleMinLabel: field.scaleMinLabel,
        scaleMaxLabel: field.scaleMaxLabel,
        ratingMax: field.ratingMax,
        ratingIcon: field.ratingIcon,
        includeYear: field.includeYear,
        includeTime: field.includeTime,
        durationMode: field.durationMode,
        validation: field.validation,
        branchRules: field.branchRules,
        fileMaxCount: field.fileMaxCount,
        fileMaxSizeMb: field.fileMaxSizeMb,
        fileAllowedTypes: field.fileAllowedTypes,
      })),
    },
    closedReason: null,
    hasResponded: Boolean(existing),
    canEdit,
    existingAnswers: canEdit && existing ? editableAnswers(form.fields, existing.answers) : undefined,
    editError,
    shuffleSeed: randomUUID(),
  };
}
