import { z } from "zod";
import type { AnswerInput } from "@/lib/forms/response-schema";

export const BRANCH_SUBMIT = "SUBMIT" as const;

export const branchRuleSchema = z.object({
  optionId: z.string().min(1),
  destination: z.string().min(1),
});

export const branchRulesSchema = z.array(branchRuleSchema).max(50);
export type BranchRule = z.infer<typeof branchRuleSchema>;

export function parseBranchRules(value: unknown): BranchRule[] {
  const parsed = branchRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

type BranchField = {
  id: string;
  type: string;
  branchRules?: unknown;
};

/** 현재 답변으로 실제 방문하는 필드만 계산합니다. SECTION_HEADER가 새 섹션의 첫 필드입니다. */
export function reachableFormFields<T extends BranchField>(fields: T[], answers: Record<string, AnswerInput>): T[] {
  const sections: T[][] = [];
  for (const field of fields) {
    if (!sections.length || field.type === "SECTION_HEADER") sections.push([]);
    sections[sections.length - 1].push(field);
  }
  const sectionByHeaderId = new Map<string, number>();
  sections.forEach((section, index) => {
    if (section[0]?.type === "SECTION_HEADER") sectionByHeaderId.set(section[0].id, index);
  });

  const reached: T[] = [];
  const visited = new Set<number>();
  let sectionIndex = 0;
  while (sectionIndex < sections.length && !visited.has(sectionIndex)) {
    visited.add(sectionIndex);
    const section = sections[sectionIndex];
    reached.push(...section);

    const branchingField = section.find((field) => parseBranchRules(field.branchRules).length > 0);
    const selected = branchingField ? answers[branchingField.id]?.selectedOptionIds?.[0] : undefined;
    const destination = selected
      ? parseBranchRules(branchingField?.branchRules).find((rule) => rule.optionId === selected)?.destination
      : undefined;
    if (destination === BRANCH_SUBMIT) break;
    const target = destination ? sectionByHeaderId.get(destination) : undefined;
    sectionIndex = target !== undefined && target > sectionIndex ? target : sectionIndex + 1;
  }
  return reached;
}

