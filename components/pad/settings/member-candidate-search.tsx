"use client";

import { useEffect, useId, useState } from "react";
import { LoaderCircle, Search, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

export type MemberCandidate = { id: string; role: string; name: string | null; loginIdentifier: string };

const roleLabel: Record<string, string> = {
  STUDENT: "학생",
  TEACHER: "교사",
  ADMIN: "관리자",
  SUPER_ADMIN: "전체관리자",
};

// placeholder에 조직 범위를 적지 않습니다 — 범위는 역할마다 다르고(전체관리자: 전체, 교사: 같은
// 학교, 학생: 같은 학급) 서버가 이미 그 범위로만 후보를 돌려줍니다.
export function MemberCandidateSearch({ endpoint, excludedIds = [], onSelect, placeholder = "이름·아이디로 구성원 검색", retainAfterSelect = false }: {
  endpoint: string;
  excludedIds?: string[];
  onSelect: (candidate: MemberCandidate) => void | Promise<void>;
  placeholder?: string;
  retainAfterSelect?: boolean;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const excluded = new Set(excludedIds);
  const searching = query.trim() !== "";

  useEffect(() => {
    // 검색어가 비어 있으면 아무 것도 조회하지 않습니다 — 마운트되자마자, 또는 입력칸을 지울
    // 때마다 학교·학급 전체를 훑는 요청을 보내던 예전 동작을 없앴습니다. candidates·note·error·
    // loading을 여기서 곧바로 비우면 이펙트 본문에서 동기적으로 setState하는 셈이라 렌더 연쇄를
    // 유발합니다(react-hooks/set-state-in-effect, PagedSelectableList의 idle과 같은 이유) — 그래서
    // 비우지 않고, 아래 렌더링이 검색어가 없을 때는 이 값들을 아예 쳐다보지 않는 것으로 리셋과
    // 같은 효과를 냅니다.
    if (query.trim() === "") return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) setLoading(true); });
    const timer = setTimeout(() => {
      fetch(`${endpoint}?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("후보를 불러오지 못했습니다.")))
        .then((result) => {
          setCandidates(result.candidates ?? []);
          setNote(result.note ?? "");
          setError("");
        })
        .catch((reason) => { if (!(reason instanceof DOMException)) setError(reason instanceof Error ? reason.message : "후보를 불러오지 못했습니다."); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [endpoint, query]);

  const visible = candidates.filter((candidate) => !excluded.has(candidate.id));

  async function select(candidate: MemberCandidate) {
    setSelectingId(candidate.id);
    setError("");
    try {
      await onSelect(candidate);
      if (!retainAfterSelect) setCandidates((current) => current.filter((item) => item.id !== candidate.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "멤버를 선택하지 못했습니다.");
    } finally {
      setSelectingId(null);
    }
  }

  return (
    <div className="select-box">
      {/* 검색줄을 <label>이 아니라 <div>로 감쌉니다: 이 컴포넌트는 패드 생성 모달의
          .stack-form 안에서도 쓰이는데, .stack-form label { flex-direction: column }이
          (0,1,1) 특이성으로 .select-search(0,1,0)를 이겨 아이콘·입력칸이 세로로 깨집니다.
          예전엔 전용 module.css로 특이성을 (0,2,0)까지 끌어올려 이겼지만(.box .search),
          애초에 <label>을 안 쓰면 그 선택자에 걸리지 않아 싸움 자체가 사라집니다. 스크린리더용
          라벨은 아래 sr-only <label htmlFor>로 입력과 따로 연결합니다. */}
      <div className="select-search">
        <Search size={15} aria-hidden />
        <label className="sr-only" htmlFor={searchId}>초대 멤버 검색</label>
        <input id={searchId} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
      </div>
      {!searching ? (
        <p className="select-note">이름이나 아이디로 검색하면 초대할 수 있는 구성원이 보여요.</p>
      ) : (
        <>
          {note && <p className="select-note">{note}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          {loading && <p className="select-note"><LoaderCircle size={13} className="spin" aria-hidden />찾는 중...</p>}
          {!loading && !note && visible.length === 0 && <p className="select-note">일치하는 구성원이 없어요.</p>}
          {!loading && visible.length > 0 && (
            <ul className="select-list">
              {visible.map((candidate) => (
                <li key={candidate.id}>
                  <div className="select-row" data-static="true">
                    <Avatar name={candidate.name} identifier={candidate.loginIdentifier} size="small" />
                    <span className="select-row-copy"><b>{candidate.name || "이름 없음"}</b><small>{candidate.loginIdentifier} · {roleLabel[candidate.role] ?? candidate.role}</small></span>
                    <button type="button" className="button soft small" disabled={selectingId !== null} onClick={() => void select(candidate)}>
                      {selectingId === candidate.id ? <LoaderCircle size={13} className="spin" aria-hidden /> : <UserPlus size={13} aria-hidden />}
                      추가
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
