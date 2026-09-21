// LIVE 리더보드 순위 계산의 순수 부분. DB 조회(lib/realtime/socket-server.ts의 buildLeaderboard)와
// 분리해 두어 순위·이탈자 계산 자체를 DB 없이 검증할 수 있습니다.

export const LEADERBOARD_LIMIT = 3;

export type LeaderboardParticipant = { id: string; nickname: string; score: number; joinedAt: Date };

export type LeaderboardEntry = {
  participantId: string;
  nickname: string;
  score: number;
  rank: number;
  previousRank: number;
  previousScore: number;
};

function compareParticipants(left: { score: number; joinedAt: Date; id: string }, right: { score: number; joinedAt: Date; id: string }) {
  return right.score - left.score || left.joinedAt.getTime() - right.joinedAt.getTime() || left.id.localeCompare(right.id);
}

/**
 * 현재 TOP 3만 반환하면 방금 4위로 밀려난 이전 3위가 payload에서 사라져 퇴장 애니메이션을
 * 그릴 재료가 없습니다. `includePreviousTop`이 켜지면 현재 TOP 3와, 이번 문항 점수를 빼서
 * 계산한 이전 TOP 3의 합집합(최대 6명)을 반환합니다 — 이탈자는 rank가 4 이상으로 잡혀
 * 화면이 "3행 아래로 빠지는" 자리로 위치를 잡을 수 있습니다.
 *
 * 최종 순위(questionId 없음)는 이전 문항이라는 개념이 없어 늘 현재 TOP 3만 돌려줍니다.
 */
export function buildLeaderboardEntries(
  participants: LeaderboardParticipant[],
  pointsAwardedByParticipant: Map<string, number>,
  options: { includePreviousTop?: boolean } = {},
): LeaderboardEntry[] {
  const currentOrder = participants.toSorted(compareParticipants);
  const currentRankById = new Map(currentOrder.map((participant, index) => [participant.id, index + 1]));

  if (!options.includePreviousTop) {
    return currentOrder.slice(0, LEADERBOARD_LIMIT).map((participant, index) => ({
      participantId: participant.id,
      nickname: participant.nickname,
      score: participant.score,
      rank: index + 1,
      previousRank: index + 1,
      previousScore: participant.score,
    }));
  }

  const previousParticipants = participants.map((participant) => ({
    ...participant,
    score: participant.score - (pointsAwardedByParticipant.get(participant.id) ?? 0),
  }));
  const previousOrder = previousParticipants.toSorted(compareParticipants);
  const previousRankById = new Map(previousOrder.map((participant, index) => [participant.id, index + 1]));
  const previousScoreById = new Map(previousParticipants.map((participant) => [participant.id, participant.score]));

  const unionIds = new Set([
    ...currentOrder.slice(0, LEADERBOARD_LIMIT).map((participant) => participant.id),
    ...previousOrder.slice(0, LEADERBOARD_LIMIT).map((participant) => participant.id),
  ]);
  const byId = new Map(participants.map((participant) => [participant.id, participant]));

  return [...unionIds]
    .map((id) => {
      const participant = byId.get(id)!;
      return {
        participantId: id,
        nickname: participant.nickname,
        score: participant.score,
        rank: currentRankById.get(id)!,
        previousRank: previousRankById.get(id)!,
        previousScore: previousScoreById.get(id)!,
      };
    })
    .toSorted((left, right) => left.rank - right.rank || left.previousRank - right.previousRank);
}
