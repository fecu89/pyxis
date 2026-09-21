"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// 사이드바 하위 항목의 개수 배지(`RouteDef.nav.countKey`)를 화면 → 셸로 올리는 통로입니다.
//
// **왜 셸이 직접 조회하지 않는가.** 사이드바는 `(workspace)/layout.tsx`가 그리는데, App Router는
// 같은 레이아웃을 공유하는 페이지끼리 이동할 때 레이아웃을 다시 렌더링하지 않습니다. 그래서
// 레이아웃에서 서버 조회를 하면 ① 패드만 쓰는 사람에게도 퀴즈 집계가 실행되고 ② 즐겨찾기를
// 껐다 켜도 배지가 그대로 굳습니다. `/api/quiz/quizzes/counts` 같은 전용 엔드포인트를 사이드바가
// 부르는 방법도 있지만, 같은 수를 이미 계산한 페이지가 바로 옆에 있는데 DB를 한 번 더 왕복하고
// 화면의 목록과 배지가 서로 다른 시점을 가리킬 수 있습니다.
//
// 그래서 이미 집계를 들고 있는 화면이 그대로 올려 줍니다. 퀴즈 화면이 마운트되지 않으면 값이
// 비므로 "퀴즈 섹션이 아닐 때는 조회하지 않는다"가 구조적으로 지켜집니다.

type NavCounts = Readonly<Record<string, number>>;

const EMPTY: NavCounts = {};

// 읽는 쪽(사이드바)과 쓰는 쪽(화면)의 컨텍스트를 나눕니다. 하나로 두면 개수가 바뀔 때마다
// 올려 주는 화면까지 같이 렌더링됩니다.
const CountsContext = createContext<NavCounts>(EMPTY);
const PublishContext = createContext<(counts: NavCounts | null) => void>(() => {});

export function NavCountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<NavCounts>(EMPTY);
  const publish = useCallback((next: NavCounts | null) => setCounts(next ?? EMPTY), []);
  return (
    <PublishContext.Provider value={publish}>
      <CountsContext.Provider value={counts}>{children}</CountsContext.Provider>
    </PublishContext.Provider>
  );
}

/** 사이드바가 읽습니다. 값이 없는 키는 배지를 그리지 않습니다. */
export function useNavCounts(): NavCounts {
  return useContext(CountsContext);
}

/**
 * 집계를 가진 화면이 호출합니다. 언마운트하면 비워서, 다른 섹션으로 옮겼을 때 지난 화면의
 * 숫자가 사이드바에 남지 않게 합니다.
 */
export function usePublishNavCounts(counts: NavCounts) {
  const publish = useContext(PublishContext);
  // 객체 아이덴티티는 렌더마다 바뀌므로 직렬화한 값으로 비교합니다.
  const key = JSON.stringify(counts);
  useEffect(() => {
    publish(JSON.parse(key) as NavCounts);
    return () => publish(null);
  }, [key, publish]);
}
