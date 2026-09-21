// 워드 클라우드 집계. 학생은 서술형으로 입력하고, 그 문장을 단어로 쪼개 빈도를 셉니다.
// 집계 규칙을 서버(실시간 브로드캐스트)와 화면(리포트)이 함께 쓰므로 순수 모듈로 둡니다.

export const WORD_CLOUD_MAX_LENGTH = 200;
/** 화면에 그릴 최대 단어 수. 넘으면 빈도 상위만 남깁니다. */
export const WORD_CLOUD_MAX_WORDS = 60;

// 조사·접속사처럼 뜻을 담지 않는 토큰은 빼야 "그리고/그래서"가 가장 큰 단어가 되는 일을 막습니다.
const STOP_WORDS = new Set([
  "그리고", "그래서", "하지만", "그러나", "그런데", "또한", "때문에", "정말", "너무", "매우", "조금",
  "많이", "약간", "그냥", "아주", "가장", "제일", "저는", "제가", "나는", "내가", "우리", "저희",
  "것", "수", "등", "및", "때", "거", "게", "좀", "더", "잘", "안", "못",
  "the", "and", "for", "but", "with", "that", "this", "was", "are", "you", "your",
]);

/**
 * 문장을 단어로 쪼갭니다. 한글·영문·숫자만 남기고 나머지는 구분자로 봅니다.
 *
 * 한국어 조사를 떼는 형태소 분석은 하지 않습니다 — 사전 없이 규칙으로 자르면 "우리는"에서
 * "우리"를 얻는 대신 "바나나"가 "바나"가 되는 쪽이 더 흔합니다. 수업에서 쓰는 짧은 단어 응답에는
 * 원형 그대로 세는 편이 오히려 정확합니다.
 */
export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && word.length <= 30 && !STOP_WORDS.has(word));
}

export type WordCloudEntry = { word: string; count: number };

/**
 * 제출 문장들을 빈도 순 단어 목록으로 집계합니다. 같은 사람이 한 문장 안에서 같은 단어를 여러 번
 * 써도 1로 셉니다 — 아니면 한 명이 같은 단어를 반복해 클라우드를 통째로 장악할 수 있습니다.
 */
export function buildWordCloud(responses: (string | null)[]): WordCloudEntry[] {
  const counts = new Map<string, number>();
  for (const response of responses) {
    if (!response) continue;
    for (const word of new Set(tokenizeWords(response))) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((left, right) => right.count - left.count || left.word.localeCompare(right.word, "ko"))
    .slice(0, WORD_CLOUD_MAX_WORDS);
}

/**
 * 빈도를 0~1의 강조도로 바꿉니다. 화면은 이 값 하나로 글자 크기와 색을 함께 정하므로,
 * 크기와 색이 서로 다른 기준으로 움직여 "큰데 흐린 단어"가 생기지 않습니다.
 * 최빈 단어가 1이고, 전부 같은 빈도면 모두 1입니다.
 */
export function wordCloudWeight(count: number, maxCount: number, minCount: number) {
  if (maxCount <= minCount) return 1;
  return (count - minCount) / (maxCount - minCount);
}
