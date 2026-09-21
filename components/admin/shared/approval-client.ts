export type ApprovalAction = "APPROVE" | "REJECT";

export async function submitApprovalReview(url: string, action: ApprovalAction, reason: string) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, reason }),
  });
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "승인 요청을 처리하지 못했습니다.");
}

export async function approveSelectedRequests(
  ids: string[],
  urlFor: (id: string) => string,
  reason: string,
) {
  const results = await Promise.all(ids.map(async (id) => {
    try {
      await submitApprovalReview(urlFor(id), "APPROVE", reason);
      return { id, ok: true as const };
    } catch (error) {
      return { id, ok: false as const, error: error instanceof Error ? error.message : "처리하지 못했습니다." };
    }
  }));
  return {
    approvedIds: results.filter((result) => result.ok).map((result) => result.id),
    failed: results.filter((result): result is Extract<typeof result, { ok: false }> => !result.ok),
  };
}
