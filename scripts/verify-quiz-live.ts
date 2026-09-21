// LIVE 퀴즈 진행 화면의 순수 계산 회귀 검증(mdFiles/quizLiveFix.md). DB나 소켓 서버 없이,
// 시퀀스 단계 판정·읽기 시간 정책·리더보드 합집합 계산만 검증합니다.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COUNTDOWN_STEP_MS,
  buildQuestionSequencePayload,
  countdownStepAt,
  questionSequenceDelayMs,
  readingDurationMs,
  sequenceStageAt,
} from "../lib/quiz/question-sequence";
import { buildLeaderboardEntries } from "../lib/quiz/live-leaderboard";
import { QUIZ_LIVE_AUDIO_SLOTS } from "../lib/quiz/live-audio-shape";

function main() {
  // ── 1배 문항은 배수 인트로가 전혀 없어야 합니다(hydration 직후 첫 프레임도 포함) ──
  const basicQuestion = { id: "q1", position: 0, points: 1000, text: "기본 문항", imageUrl: null, imageAlt: null, imagePlaceholder: null };
  const startsAt = new Date("2026-01-01T00:00:10.000Z");
  const basicPayload = buildQuestionSequencePayload(basicQuestion, 5, startsAt);
  const countdownStartMs = new Date(basicPayload.countdownStartsAt).getTime();
  assert.equal(
    sequenceStageAt(basicPayload, countdownStartMs - 1),
    "COUNTDOWN",
    "1,000점 문항은 초기 프레임(countdownStart 이전)에도 배수 인트로 없이 곧장 COUNTDOWN이어야 합니다.",
  );
  assert.equal(sequenceStageAt(basicPayload, countdownStartMs - 10_000), "COUNTDOWN", "1,000점 문항은 언제나 배수 인트로가 없어야 합니다.");

  // ── 2배·3배 문항만 배수 인트로가 있어야 합니다 ──
  for (const points of [2000, 3000]) {
    const question = { ...basicQuestion, points };
    const payload = buildQuestionSequencePayload(question, 5, startsAt);
    const start = new Date(payload.countdownStartsAt).getTime();
    assert.equal(sequenceStageAt(payload, start - 1), "MULTIPLIER_INTRO", `${points}점 문항은 countdownStart 이전에 MULTIPLIER_INTRO여야 합니다.`);
    assert.equal(sequenceStageAt(payload, start), "COUNTDOWN", `${points}점 문항은 countdownStart 시각부터 COUNTDOWN이어야 합니다.`);
  }
  assert.equal(sequenceStageAt(basicPayload, countdownStartMs), "COUNTDOWN");
  const readingStartMs = new Date(basicPayload.readingStartsAt).getTime();
  assert.equal(sequenceStageAt(basicPayload, readingStartMs), "READING");

  // ── 카운트다운 경계 시각에서 3 → 2 → 1 순서 ──
  assert.equal(countdownStepAt(readingStartMs, readingStartMs - COUNTDOWN_STEP_MS * 3), 3);
  assert.equal(countdownStepAt(readingStartMs, readingStartMs - COUNTDOWN_STEP_MS * 2 - 1), 3);
  assert.equal(countdownStepAt(readingStartMs, readingStartMs - COUNTDOWN_STEP_MS * 2), 2);
  assert.equal(countdownStepAt(readingStartMs, readingStartMs - COUNTDOWN_STEP_MS - 1), 2);
  assert.equal(countdownStepAt(readingStartMs, readingStartMs - COUNTDOWN_STEP_MS), 1);
  assert.equal(countdownStepAt(readingStartMs, readingStartMs - 1), 1, "readingStart 직전까지도 1이어야 합니다(재접속 시 3부터 다시 재생되면 안 됨).");

  // ── 읽기 시간 정책: 최소 4.5초, 최대 12초, 문자당 140ms, 이미지 보너스 1.5초 ──
  assert.equal(readingDurationMs({ text: "2 + 2는?" }), 4_500, "짧은 질문은 최소 4.5초여야 합니다.");
  assert.equal(readingDurationMs({ text: "a".repeat(20) }), 5_200, "20자 질문은 약 5.2초여야 합니다.");
  assert.equal(readingDurationMs({ text: "a".repeat(40) }), 8_000, "40자 질문은 약 8초여야 합니다.");
  assert.equal(readingDurationMs({ text: "a".repeat(200) }), 12_000, "아주 긴 질문도 최대 12초를 넘지 않아야 합니다.");
  const withoutImage = readingDurationMs({ text: "a".repeat(20) });
  const withImage = readingDurationMs({ text: "a".repeat(20), imageUrl: "https://example.com/a.png" });
  assert.equal(withImage - withoutImage, 1_500, "이미지가 있으면 1.5초가 추가돼야 합니다.");
  assert.equal(
    readingDurationMs({ text: "짧음", imageUrl: "https://example.com/a.png" }),
    6_000,
    "짧은 문항도 최소 읽기 시간 4.5초에 이미지 보너스 1.5초가 추가돼야 합니다.",
  );
  const withPlaceholder = readingDurationMs({ text: "a".repeat(20), imagePlaceholder: "placeholder" });
  assert.equal(withPlaceholder, withImage, "imageUrl이 없어도 imagePlaceholder만으로 이미지 보너스가 적용돼야 합니다.");
  // 이모지처럼 서로게이트 페어인 문자를 두 글자로 잘못 세지 않아야 합니다.
  assert.equal(readingDurationMs({ text: "😀".repeat(20) }), 5_200, "서로게이트 페어 문자는 한 글자로 세어야 합니다.");

  // ── 서버 지연(questionSequenceDelayMs)과 payload의 절대시각이 정확히 맞물려야 합니다 ──
  const boostedQuestion = { id: "q2", position: 1, points: 2000, text: "배수 문항", type: "SINGLE_CHOICE", imageUrl: null, imageAlt: null, imagePlaceholder: null };
  const now = new Date("2026-01-01T00:00:00.000Z");
  const delayMs = questionSequenceDelayMs(boostedQuestion);
  const boostedStartsAt = new Date(now.getTime() + delayMs);
  const boostedPayload = buildQuestionSequencePayload(boostedQuestion, 5, boostedStartsAt);
  const boostedReadingMs = readingDurationMs(boostedQuestion);
  assert.equal(
    new Date(boostedPayload.startsAt).getTime() - new Date(boostedPayload.readingStartsAt).getTime(),
    boostedReadingMs,
    "startsAt과 readingStartsAt의 간격은 readingDurationMs와 정확히 같아야 합니다.",
  );
  assert.equal(
    new Date(boostedPayload.readingStartsAt).getTime() - new Date(boostedPayload.countdownStartsAt).getTime(),
    COUNTDOWN_STEP_MS * 3,
    "readingStartsAt과 countdownStartsAt의 간격은 카운트다운 총 길이와 같아야 합니다.",
  );
  assert.equal(
    new Date(boostedPayload.countdownStartsAt).getTime() - now.getTime(),
    2_700,
    "countdownStartsAt은 지금으로부터 배수 인트로 길이(2.7초)만큼 떨어져 있어야 합니다.",
  );
  // 슬라이드는 시퀀스를 타지 않고 지연이 0이어야 합니다.
  assert.equal(questionSequenceDelayMs({ ...boostedQuestion, type: "SLIDE" }), 0);

  // ── 리더보드 합집합: 이전 TOP 3 이탈자와 새 TOP 3 진입자가 모두 포함돼야 합니다 ──
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  const participants = [
    { id: "p1", nickname: "p1", score: 300, joinedAt: t0 },
    { id: "p2", nickname: "p2", score: 250, joinedAt: t0 },
    { id: "p3", nickname: "p3", score: 220, joinedAt: t0 }, // 이번 문항에서 +200을 얻어 새로 TOP 3 진입
    { id: "p4", nickname: "p4", score: 210, joinedAt: t0 }, // 이전 TOP 3(3위)였지만 이번엔 4위로 밀려남
  ];
  const pointsAwarded = new Map([["p3", 200]]);
  const union = buildLeaderboardEntries(participants, pointsAwarded, { includePreviousTop: true });
  const byId = new Map(union.map((entry) => [entry.participantId, entry]));
  assert.equal(union.length, 4, "겹치지 않는 이전/현재 TOP 3의 합집합은 4명이어야 합니다(p1·p2 중복, p3 진입, p4 이탈).");
  assert.deepEqual(byId.get("p1"), { participantId: "p1", nickname: "p1", score: 300, rank: 1, previousRank: 1, previousScore: 300 });
  assert.deepEqual(byId.get("p2"), { participantId: "p2", nickname: "p2", score: 250, rank: 2, previousRank: 2, previousScore: 250 });
  assert.deepEqual(byId.get("p3"), { participantId: "p3", nickname: "p3", score: 220, rank: 3, previousRank: 4, previousScore: 20 }, "p3는 새로 진입한 3위(이전에는 4위)여야 합니다.");
  assert.deepEqual(byId.get("p4"), { participantId: "p4", nickname: "p4", score: 210, rank: 4, previousRank: 3, previousScore: 210 }, "p4는 이번에 4위로 밀려난 이탈자(이전에는 3위)여야 합니다.");

  // ── 최종 순위(questionId 없음)는 이전 문항 개념이 없어 previousRank===rank, previousScore===score ──
  const final = buildLeaderboardEntries(participants, pointsAwarded, { includePreviousTop: false });
  assert.equal(final.length, 3, "최종 순위는 항상 현재 TOP 3만 반환해야 합니다.");
  for (const entry of final) {
    assert.equal(entry.previousRank, entry.rank);
    assert.equal(entry.previousScore, entry.score);
  }

  // ── 동점 정렬은 점수 → 입장 시각 → participant id 순으로 결정적이어야 합니다 ──
  const tieByJoinedAt = buildLeaderboardEntries(
    [
      { id: "zzz", nickname: "zzz", score: 100, joinedAt: new Date("2026-01-01T00:00:05.000Z") },
      { id: "aaa", nickname: "aaa", score: 100, joinedAt: new Date("2026-01-01T00:00:01.000Z") },
    ],
    new Map(),
  );
  assert.deepEqual(tieByJoinedAt.map((entry) => entry.participantId), ["aaa", "zzz"], "동점이면 먼저 입장한 참가자가 앞이어야 합니다.");

  const tieById = buildLeaderboardEntries(
    [
      { id: "bbb", nickname: "bbb", score: 100, joinedAt: t0 },
      { id: "aaa", nickname: "aaa", score: 100, joinedAt: t0 },
    ],
    new Map(),
  );
  assert.deepEqual(tieById.map((entry) => entry.participantId), ["aaa", "bbb"], "점수·입장 시각까지 같으면 participant id 사전순이어야 합니다.");

  // ── 최종 시상대는 애니메이션 CSS가 누락돼도 opacity:0에 갇히지 않아야 합니다 ──
  const liveGameSource = readFileSync(new URL("../components/quiz/live-game-ui.tsx", import.meta.url), "utf8");
  const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(globalCss, /\.animate-podium-rise\s*\{[^}]*animation:/, "최종 시상대 애니메이션 클래스가 CSS에 정의돼야 합니다.");
  assert.doesNotMatch(liveGameSource, /animate-podium-rise[^`\n]*opacity-0/, "CSS 로드 실패나 reduce-motion에서도 최종 시상대가 숨으면 안 됩니다.");

  // ── 라이브 오디오: 고정 슬롯·이벤트 경계·HTTP 스트림 성능 경계 ──
  assert.deepEqual(QUIZ_LIVE_AUDIO_SLOTS, [
    "lobbyMusic", "gameMusic", "startBell", "countdownBeep", "scoreTick", "finishBell", "podiumFanfare",
  ], "관리 화면·저장 JSON·스트림 API가 같은 7개 슬롯을 공유해야 합니다.");
  const audioControllerSource = readFileSync(new URL("../components/quiz/live-audio-controller.tsx", import.meta.url), "utf8");
  const leaderboardUiSource = readFileSync(new URL("../components/quiz/live-leaderboard.tsx", import.meta.url), "utf8");
  const hostSource = readFileSync(new URL("../components/quiz/host-session.tsx", import.meta.url), "utf8");
  const playSource = readFileSync(new URL("../components/quiz/play-session.tsx", import.meta.url), "utf8");
  const streamSource = readFileSync(new URL("../app/api/quiz/live-audio/[slot]/route.ts", import.meta.url), "utf8");
  const uploadSource = readFileSync(new URL("../app/api/admin/quiz-live-audio/[slot]/route.ts", import.meta.url), "utf8");
  const volumeApiSource = readFileSync(new URL("../app/api/admin/quiz-live-audio/route.ts", import.meta.url), "utf8");
  const audioSettingsSource = readFileSync(new URL("../lib/quiz/live-audio.ts", import.meta.url), "utf8");
  const audioAdminSource = readFileSync(new URL("../components/admin/quiz-live-audio-settings.tsx", import.meta.url), "utf8");
  const socketServerSource = readFileSync(new URL("../lib/realtime/socket-server.ts", import.meta.url), "utf8");
  assert.match(audioControllerSource, /sequenceStageAt\(sequence, now\)[\s\S]*"COUNTDOWN"/, "카운트다운 효과음은 서버 절대시각 단계 판정을 재사용해야 합니다.");
  assert.match(audioControllerSource, /SCORE_TICK_INTERVAL_MS\s*=\s*90/, "동시 점수 카드 효과음은 화면 전체에서 제한해야 합니다.");
  assert.doesNotMatch(leaderboardUiSource, /live-audio-controller/, "점수 UI가 전체 오디오 엔진을 import해 편집기 미리보기 청크를 키우면 안 됩니다.");
  assert.match(hostSource, /socket\.on\("question:sequence"[\s\S]*announceFirstQuestion\(payload\.questionIndex\)/, "호스트 시작음은 실제 문항 이벤트에서 발생해야 합니다.");
  assert.match(playSource, /socket\.on\("session:ended"[\s\S]*setFinishSignal/, "학생 종료음은 실제 종료 이벤트에 연결돼야 합니다.");
  assert.doesNotMatch(playSource, /import\s*\{[^}]*\bio\b[^}]*\}\s*from\s*"socket\.io-client"/, "ASYNC 플레이 초기 청크가 Socket.IO 런타임을 정적 import하면 안 됩니다.");
  assert.match(playSource, /import\("socket\.io-client"\)/, "학생 LIVE 소켓 런타임은 LIVE 마운트 시 동적으로 읽어야 합니다.");
  assert.doesNotMatch(hostSource.match(/const joinSession[\s\S]*?socket\.on\("connect"/)?.[0] ?? "", /setQuizStartSignal|setLeaderboardSignal|setFinishSignal/, "재접속 스냅샷이 지난 효과음을 다시 발생시키면 안 됩니다.");
  assert.match(hostSource, /\(response\.currentSequence \?\? response\.currentQuestion\)\?\.questionIndex === 0\) firstQuestionAnnounced = true/, "첫 문항 도중 재접속했다면 뒤이은 question:show가 시작음을 늦게 반복하지 않게 표시해야 합니다.");
  assert.match(playSource, /\(response\.currentSequence \?\? response\.currentQuestion\)\?\.questionIndex === 0\) firstQuestionAnnounced = true/, "학생 재접속도 첫 문항 시작음을 뒤늦게 반복하지 않아야 합니다.");
  assert.match(streamSource, /status:\s*206/, "음원 스트림은 byte range 206 응답을 지원해야 합니다.");
  assert.match(streamSource, /max-age=31536000, immutable/, "revision 음원 URL은 immutable 캐시여야 합니다.");
  assert.match(audioSettingsSource, /MAX_RETIRED_TRACKS\s*=\s*14/, "교체된 immutable 음원은 진행 중 수업을 보호하되 유예 개수 상한을 가져야 합니다.");
  assert.match(streamSource, /storedQuizLiveAudioTrack\(await getStoredQuizLiveAudio\(\), slot, requestedRevision\)/, "음원 스트림은 유예된 이전 revision의 range 요청도 복원해야 합니다.");
  assert.match(audioSettingsSource, /currentLoad\?\.generation === generation/, "100명 동시 입장의 설정 조회 Promise를 합쳐야 합니다.");
  assert.match(audioSettingsSource, /pyxQuizLiveAudioGeneration/, "관리자 변경 중인 낡은 설정 조회가 캐시를 다시 덮지 못해야 합니다.");
  assert.match(audioControllerSource, /removeAttribute\("src"\)/, "오디오 컨트롤러가 교체·언마운트된 미디어 버퍼를 계속 붙잡으면 안 됩니다.");
  assert.match(audioAdminSource, /preload="none"/, "관리자 미리듣기가 7개 음원을 탭 진입 즉시 요청하면 안 됩니다.");
  assert.match(uploadSource, /requireRole\(\["SUPER_ADMIN"\]\)/, "음원 변경은 전체관리자만 할 수 있어야 합니다.");
  assert.match(uploadSource, /allowedTypes:\s*\["AUDIO"\]/, "음원 업로드는 공용 실제 파일 형식 검사를 통과해야 합니다.");
  assert.match(volumeApiSource, /readJsonWithLimit\(request, VOLUME_BODY_MAX_BYTES\)/, "볼륨 API도 작은 JSON 본문 상한을 가져야 합니다.");
  assert.match(socketServerSource, /buildFinalLeaderboardForJoin/, "종료된 세션 재접속에서도 최종 TOP 3를 복원해야 합니다.");
  assert.match(playSource, /const controller = new AbortController\(\)[\s\S]*?start[\s\S]*?controller\.abort\(\)/, "ASYNC 첫 시작·문항 요청은 화면 이탈 때 취소해야 합니다.");

  console.log("quiz_live_checks=passed sequence_stage=ok countdown_step=ok reading_duration=ok delay_sync=ok leaderboard_union=ok tie_order=ok final_podium=ok live_audio=ok");
}

main();
