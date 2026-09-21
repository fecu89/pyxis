import { z } from "zod";

export const cloneBoardSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  includeSections: z.boolean().default(true),
  includePosts: z.boolean().default(true),
  includeAttachments: z.boolean().default(false),
  includeSettings: z.boolean().default(true),
  includeMembers: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.includePosts && !value.includeSections) {
    context.addIssue({ code: "custom", path: ["includeSections"], message: "게시물을 복제하려면 섹션도 포함해야 합니다." });
  }
  if (value.includeAttachments && !value.includePosts) {
    context.addIssue({ code: "custom", path: ["includePosts"], message: "첨부파일을 복제하려면 게시물도 포함해야 합니다." });
  }
});

export const dashboardFolderSchema = z.object({
  name: z.string().trim().min(1).max(60),
}).strict();

export const dashboardFolderPatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), folderId: z.string().min(1).max(100), name: z.string().trim().min(1).max(60) }).strict(),
  z.object({ action: z.literal("set-board"), folderId: z.string().min(1).max(100), boardId: z.string().min(1).max(100), included: z.boolean() }).strict(),
]);

export function normalizeFolderName(value: string) {
  const name = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return { name, nameKey: name.toLocaleLowerCase("ko") };
}

export type CloneBoardOptions = z.infer<typeof cloneBoardSchema>;
