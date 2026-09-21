// 특정 순간에 어떤 사용자가 어떤 보드의 실시간 스트림(SSE)에 연결되어 있는지 추적하는
// 메모리 레지스트리입니다. "지금 그 보드를 보고 있는 사용자"에게는 같은 소식을 개인 알림으로
// 중복 발송하지 않기 위해 씁니다. 단일 인스턴스 전제이며, 여러 인스턴스로 확장할 때는
// 공유 저장소(Redis 등)로 옮겨야 합니다.
//
// Set<userId>로 두면 같은 사용자가 탭을 두 개 열었을 때 항목이 하나만 생기고, 탭 하나를 닫는
// 순간 delete로 완전히 사라져 아직 보고 있는 다른 탭이 "안 보는 중"으로 잡혔습니다. 연결 수를
// 세는 참조 카운트로 바꿔 마지막 연결이 끊길 때만 목록에서 빠지게 합니다.
type ViewerCounts = Map<string, Map<string, number>>;

const globalForViewers = globalThis as unknown as { pyxCourseBoardViewers?: ViewerCounts };

function registry(): ViewerCounts {
  if (!globalForViewers.pyxCourseBoardViewers) globalForViewers.pyxCourseBoardViewers = new Map();
  return globalForViewers.pyxCourseBoardViewers;
}

export function markViewing(boardId: string, userId: string) {
  const map = registry();
  const counts = map.get(boardId) ?? new Map<string, number>();
  counts.set(userId, (counts.get(userId) ?? 0) + 1);
  map.set(boardId, counts);

  // 같은 연결의 정리 함수가 두 번 불려도(abort와 cancel이 모두 발생하는 경우) 카운트가 잘못
  // 내려가지 않게 합니다.
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = map.get(boardId);
    if (!current) return;
    const next = (current.get(userId) ?? 1) - 1;
    if (next <= 0) current.delete(userId);
    else current.set(userId, next);
    if (current.size === 0) map.delete(boardId);
  };
}

export function isViewingBoard(boardId: string, userId: string) {
  return (registry().get(boardId)?.get(userId) ?? 0) > 0;
}
