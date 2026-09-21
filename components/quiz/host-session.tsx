"use client";

import Link from "next/link";
import { useDialog } from "@/components/ui/app-dialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { QUIZ_NAMESPACE, SOCKET_PATH } from "@/lib/realtime/namespaces";
import { BarChart3, Hash, ListOrdered, MapPin, MessageSquareText, SlidersHorizontal } from "lucide-react";
import { CheckIcon, PlayIcon, UsersIcon } from "@/components/ui/icons";
import { CopyButton } from "@/components/ui/copy-button";
import { JoinQrCode } from "@/components/quiz/join-qr-code";
import { QuizLiveAudioController } from "@/components/quiz/live-audio-controller";
import {
  AnswerRevealEffects,
  CountdownRing,
  ContentSlide,
  FinalPodium,
  LiveGameSurface,
  LiveStageHeader,
  PointMultiplierBadge,
  QuestionSequenceStage,
  QuestionMedia,
  QuestionTypeBadge,
  SpeedScoreHint,
  type LiveQuestionPayload,
  type LiveQuestionReveal,
  type QuizQuestionPayload,
} from "@/components/quiz/live-game-ui";
import { LiveLeaderboard, type Leaderboard } from "@/components/quiz/live-leaderboard";
import { ParticipationSummaryView } from "@/components/quiz/participation-views";
import { PinDistribution } from "@/components/quiz/image-pin";
import type { QuestionSequencePayload } from "@/lib/quiz/question-sequence";
import { formatNumericStep } from "@/lib/quiz/numeric";
import { isParticipationType } from "@/lib/quiz/participation";
import type { ParticipationSummary } from "@/lib/quiz/participation-summary";
import type { QuizLiveAudioSettings } from "@/lib/quiz/live-audio-shape";

type Participant = { id: string; nickname: string; score: number; status: string; currentQuestionIndex: number; joinedAt: string };
export type HostSessionSnapshot = { session: { pinCode: string | null; status: string; livePhase: string | null; participantCount: number; requiresLogin: boolean; quiz: { title: string; totalQuestions: number } }; participants?: Participant[]; error?: string };

// 학생 화면과 같은 pad 역할 토큰 순서여야 교사·학생에게 동일한 보기 색이 보입니다.
const HOST_CHOICE_COLORS = [
  "border-brand-300/20 bg-brand-600/85",
  "border-danger-300/20 bg-danger-500/85",
  "border-info-300/20 bg-info-600/85",
  "border-warning-200/20 bg-warning-300 text-warning-950",
  "border-accent-soft-fg/20 bg-accent-soft-fg/85",
  "border-success-soft-fg/20 bg-success-soft-fg/85",
];

function mergeLeaderboardScores(participants: Participant[], leaderboard: Leaderboard) {
  const scores = new Map(leaderboard.map((entry) => [entry.participantId, entry.score]));
  return participants.map((participant) => ({ ...participant, score: scores.get(participant.id) ?? participant.score }));
}

function mergeParticipant(participants: Participant[], incoming: Participant) {
  const index = participants.findIndex((participant) => participant.id === incoming.id);
  if (index < 0) return [...participants, incoming];
  const next = [...participants];
  next[index] = incoming;
  return next;
}

function mergeParticipantSnapshot(snapshot: Participant[], current: Participant[], updatedIds: Set<string>) {
  const currentById = new Map(current.map((participant) => [participant.id, participant]));
  const snapshotIds = new Set(snapshot.map((participant) => participant.id));
  const merged = snapshot.map((participant) => updatedIds.has(participant.id) ? currentById.get(participant.id) ?? participant : participant);
  for (const participant of current) {
    if (updatedIds.has(participant.id) && !snapshotIds.has(participant.id)) merged.push(participant);
  }
  return merged;
}

export function HostSession({ sessionId, initialSnapshot, audioSettings }: { sessionId: string; initialSnapshot: HostSessionSnapshot; audioSettings: QuizLiveAudioSettings }) {
  const dialog = useDialog();
  const socketRef = useRef<Socket | null>(null);
  const pinCode = initialSnapshot.session.pinCode;
  const requiresLogin = initialSnapshot.session.requiresLogin;
  const quizTitle = initialSnapshot.session.quiz.title;
  const [connectedCount, setConnectedCount] = useState(0);
  const [participants, setParticipants] = useState<Participant[]>(initialSnapshot.participants ?? []);
  const [phase, setPhase] = useState<string | null>(initialSnapshot.session.livePhase);
  const [sequence, setSequence] = useState<QuestionSequencePayload | null>(null);
  const [question, setQuestion] = useState<LiveQuestionPayload | null>(null);
  const [reveal, setReveal] = useState<LiveQuestionReveal | null>(null);
  // 참여형 문항을 진행하는 동안 실시간으로 갱신되는 집계. 문항이 바뀌면 비웁니다.
  const [liveSummary, setLiveSummary] = useState<ParticipationSummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [ended, setEnded] = useState(initialSnapshot.session.status === "FINISHED");
  const [finalLeaderboard, setFinalLeaderboard] = useState<Leaderboard>([]);
  const [socketConnected, setSocketConnected] = useState(false);
  const [quizStartSignal, setQuizStartSignal] = useState(0);
  const [leaderboardSignal, setLeaderboardSignal] = useState(0);
  const [finishSignal, setFinishSignal] = useState(0);
  const registeredCount = participants.length;

  useEffect(() => {
    let active = true;
    let firstQuestionAnnounced = false;
    const rosterUpdatedIds = new Set<string>();
    const socket = io(QUIZ_NAMESPACE, { path: SOCKET_PATH });
    socketRef.current = socket;
    // 재연결될 때마다 다시 입장해야 합니다 — 소켓이 새로 붙으면 서버의 방(room) 멤버십이
    // 사라져서, 입장을 다시 하지 않으면 이후 브로드캐스트를 하나도 받지 못합니다.
    const joinSession = () => {
      rosterUpdatedIds.clear();
      socket.emit("session:join", { sessionId }, (response: { ok: boolean; error?: string; livePhase?: string; participantCount?: number; participants?: Participant[]; currentQuestion?: LiveQuestionPayload | null; currentSequence?: QuestionSequencePayload | null; currentReveal?: LiveQuestionReveal | null; currentLeaderboard?: Leaderboard | null; currentParticipation?: ParticipationSummary | null; finalLeaderboard?: Leaderboard | null; status?: string }) => {
        if (!active) return;
        if (!response.ok) { setError(response.error ?? "세션에 입장하지 못했습니다."); return; }
        if (response.status === "FINISHED") {
          setFinalLeaderboard(response.finalLeaderboard ?? []);
          setPhase("ENDED");
          setEnded(true);
          return;
        }
        if ((response.currentSequence ?? response.currentQuestion)?.questionIndex === 0) firstQuestionAnnounced = true;
        setPhase(response.livePhase ?? null);
        setConnectedCount(response.participantCount ?? 0);
        if (response.participants) {
          const updatedWhileJoining = new Set(rosterUpdatedIds);
          setParticipants((current) => mergeParticipantSnapshot(response.participants ?? [], current, updatedWhileJoining));
        }
        // 자리를 비운 사이 단계가 넘어갔을 수 있으므로 이전 화면 상태를 지우고 스냅샷으로 다시 그립니다.
        setSequence(response.currentSequence ?? null);
        setQuestion(response.currentSequence ? null : response.currentQuestion ?? null);
        setReveal(response.currentReveal ?? null);
        setLeaderboard(response.currentLeaderboard ?? null);
        setLiveSummary(response.currentParticipation ?? null);
        if (response.currentLeaderboard) setParticipants((current) => mergeLeaderboardScores(current, response.currentLeaderboard ?? []));
      });
    };
    socket.on("connect", () => { setSocketConnected(true); setError(null); joinSession(); });
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setError("실시간 서버에 연결하지 못했습니다. 잠시 후 새로고침해 주세요."));

    const participantJoined = ({ participantCount, participant }: { participantCount: number; participant: Participant }) => {
      rosterUpdatedIds.add(participant.id);
      setConnectedCount(participantCount);
      setParticipants((current) => mergeParticipant(current, participant));
    };
    const participantLeft = ({ participantId, participantCount, kicked }: { participantId: string; participantCount: number; kicked?: boolean }) => {
      rosterUpdatedIds.add(participantId);
      setConnectedCount(participantCount);
      if (kicked) setParticipants((current) => current.map((participant) => participant.id === participantId ? { ...participant, status: "KICKED" } : participant));
    };
    socket.on("participant:joined", participantJoined);
    socket.on("participant:left", participantLeft);
    const announceFirstQuestion = (questionIndex: number) => {
      if (questionIndex !== 0 || firstQuestionAnnounced) return;
      firstQuestionAnnounced = true;
      setQuizStartSignal((current) => current + 1);
    };
    socket.on("question:sequence", (payload: QuestionSequencePayload) => {
      announceFirstQuestion(payload.questionIndex);
      setSequence(payload);
      setQuestion(null);
      setReveal(null);
      setLeaderboard(null);
      setAnsweredCount(0);
      setLiveSummary(null);
      setPhase("QUESTION_SEQUENCE");
      setActionPending(false);
    });
    socket.on("question:show", (payload: LiveQuestionPayload) => {
      announceFirstQuestion(payload.questionIndex);
      setSequence(null);
      setQuestion(payload);
      setReveal(null);
      setLeaderboard(null);
      setAnsweredCount(0);
      setLiveSummary(null);
      setPhase("QUESTION_ACTIVE");
      setActionPending(false);
    });
    socket.on("answer:progress", ({ answeredCount: count }: { answeredCount: number }) => setAnsweredCount(count));
    // 참여형 문항의 실시간 집계. 서버가 호스트 소켓에만 보내며, 문항의 "실시간 공개"가 꺼져
    // 있으면 아예 오지 않습니다.
    socket.on("participation:update", ({ summary }: { questionId: string; summary: ParticipationSummary | null }) => setLiveSummary(summary));
    socket.on("question:reveal", (payload: LiveQuestionReveal) => {
      setReveal(payload);
      setLeaderboard(null);
      setPhase("QUESTION_REVEAL");
      setActionPending(false);
    });
    socket.on("leaderboard:show", ({ leaderboard: entries }: { questionId: string; leaderboard: Leaderboard }) => {
      setLeaderboard(entries);
      setParticipants((current) => mergeLeaderboardScores(current, entries));
      setPhase("LEADERBOARD");
      setActionPending(false);
      if (entries.length > 0) setLeaderboardSignal((current) => current + 1);
    });
    socket.on("session:ended", ({ finalLeaderboard: entries }: { finalLeaderboard: Leaderboard }) => {
      setFinalLeaderboard(entries ?? []);
      setEnded(true);
      setActionPending(false);
      setFinishSignal((current) => current + 1);
    });
    return () => { active = false; socket.disconnect(); };
  }, [sessionId]);

  function emitAction(event: "host:start" | "host:reveal" | "host:show-leaderboard" | "host:next-question" | "host:end" | "host:skip-sequence") {
    setError(null);
    setActionPending(true);
    socketRef.current?.emit(event, { sessionId }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) {
        setError(response.error ?? "요청을 처리하지 못했습니다.");
        setActionPending(false);
      }
    });
  }

  async function kickParticipant(participant: Participant) {
    const ok = await dialog.confirm({ title: `${participant.nickname} 학생을 내보낼까요?`, description: "내보낸 학생은 이 세션에 다시 들어올 수 없습니다.", danger: true, confirmLabel: "내보내기" });
    if (!ok) return;
    socketRef.current?.emit("host:kick", { sessionId, participantId: participant.id }, (response: { ok: boolean; error?: string }) => {
      if (!response.ok) setError(response.error ?? "학생을 내보내지 못했습니다.");
    });
  }


  if (ended) {
    return (
      <QuizLiveAudioController settings={audioSettings} scene="ENDED" sequence={null} quizStartSignal={quizStartSignal} leaderboardSignal={leaderboardSignal} leaderboardActive={false} finishSignal={finishSignal} hasFinalPodium={finalLeaderboard.length > 0}>
        <LiveGameSurface className="items-center justify-center">
          <div className="my-auto w-full py-8">
            {finalLeaderboard.length > 0 ? <FinalPodium entries={finalLeaderboard} title="최종 TOP 3" /> : <div className="text-center"><p className="text-xs font-black uppercase tracking-[0.24em] text-info-200">Session complete</p><h1 className="mt-3 text-4xl font-black sm:text-5xl">멋진 퀴즈였어요!</h1><p className="mt-3 text-sm font-bold text-brand-100/60">결과 리포트에서 문항별 응답을 확인할 수 있어요.</p></div>}
            <div className="mt-9 text-center"><Link href={`/quiz/activities/${sessionId}/report`} className="inline-flex min-h-13 items-center rounded-2xl bg-info-300 px-7 text-sm font-black text-brand-950 shadow-xl shadow-info-300/15">결과 리포트 보기</Link></div>
          </div>
        </LiveGameSurface>
      </QuizLiveAudioController>
    );
  }

  const lobby = !question && !sequence && phase === "LOBBY";
  const phaseLabel = lobby ? "참여 대기실" : sequence ? "문제 준비" : phase === "QUESTION_ACTIVE" ? "문제 진행 중" : phase === "QUESTION_REVEAL" ? "정답 공개" : phase === "LEADERBOARD" ? "TOP 3 공개" : "세션 연결 중";

  return (
    <QuizLiveAudioController settings={audioSettings} scene={lobby ? "LOBBY" : "GAME"} sequence={sequence} quizStartSignal={quizStartSignal} leaderboardSignal={leaderboardSignal} leaderboardActive={phase === "LEADERBOARD" && Boolean(leaderboard)} finishSignal={finishSignal} hasFinalPodium={false}>
      <LiveGameSurface fit contentClassName="min-h-0 overflow-hidden px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
      <LiveStageHeader
        title={quizTitle || "라이브 퀴즈"}
        connected={socketConnected}
        phaseLabel={phaseLabel}
        question={question ?? sequence}
        trailing={<div className="flex items-center gap-3">
          {/* 진행 중에도 지금 접속해 있는 인원이 항상 보여야 이탈을 바로 알아챌 수 있습니다. */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.08] px-3 py-1.5 text-[11px] font-black text-brand-100/80"><UsersIcon className="h-3.5 w-3.5 text-info-300" />접속 <span className="font-mono text-info-200">{connectedCount}</span>명</span>
          {pinCode ? <div className="hidden items-center gap-2 sm:flex"><span className="text-[10px] font-black uppercase tracking-[0.16em] text-brand-100/45">PIN</span><span className="font-mono text-lg font-black tracking-[0.14em] text-info-200">{pinCode}</span></div> : null}
        </div>}
      />
      {error ? <div className="mb-4 rounded-2xl border border-danger-300/30 bg-danger-400/15 px-4 py-3 text-sm font-bold text-danger-100" role="alert">{error}</div> : null}

      {sequence ? (
        <QuestionSequenceStage sequence={sequence} isHost skipPending={actionPending} onSkip={() => emitAction("host:skip-sequence")} />
      ) : lobby ? (
        <HostLobby sessionId={sessionId} pinCode={pinCode} requiresLogin={requiresLogin} participants={participants} connectedCount={connectedCount} registeredCount={registeredCount} actionPending={actionPending} onStart={() => emitAction("host:start")} onKick={kickParticipant} />
      ) : question && phase === "QUESTION_ACTIVE" ? (
        <HostActiveStage question={question} liveSummary={liveSummary} answeredCount={answeredCount} participantCount={Math.max(registeredCount, connectedCount)} actionPending={actionPending} onReveal={() => emitAction("host:reveal")} onNext={() => emitAction("host:next-question")} onEnd={() => emitAction("host:end")} />
      ) : question && phase === "QUESTION_REVEAL" && reveal ? (
        <HostRevealStage question={question} reveal={reveal} actionPending={actionPending} onShowLeaderboard={() => emitAction("host:show-leaderboard")} onNext={() => emitAction("host:next-question")} onEnd={() => emitAction("host:end")} />
      ) : question && phase === "LEADERBOARD" && leaderboard ? (
        <HostLeaderboardStage question={question} leaderboard={leaderboard} actionPending={actionPending} onNext={() => emitAction("host:next-question")} onEnd={() => emitAction("host:end")} />
      ) : (
        <section className="grid flex-1 place-items-center rounded-[32px] border border-white/10 bg-white/[0.06]"><div className="text-center"><div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/15 border-t-lime-300" /><p className="mt-5 text-sm font-black text-brand-100/60">게임 상태를 불러오는 중...</p></div></section>
      )}
      </LiveGameSurface>
    </QuizLiveAudioController>
  );
}

function HostLobby({ sessionId, pinCode, requiresLogin, participants, connectedCount, registeredCount, actionPending, onStart, onKick }: { sessionId: string; pinCode: string | null; requiresLogin: boolean; participants: Participant[]; connectedCount: number; registeredCount: number; actionPending: boolean; onStart: () => void; onKick: (participant: Participant) => void }) {
  return (
    <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(330px,0.7fr)]">
      <section className="live-game-grid grid min-h-[520px] place-items-center overflow-hidden rounded-[34px] border border-white/10 bg-white/[0.06] p-6 text-center shadow-2xl sm:p-9">
        <div className="w-full">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-info-200">Join the game</p>
          <p className="mt-4 text-sm font-bold text-brand-100/55">화면의 QR을 스캔하거나 참여 PIN을 입력하세요</p>
          <p className="mt-6 font-mono text-[clamp(3.5rem,10vw,7.5rem)] font-black leading-none tracking-[0.12em] text-white drop-shadow-2xl">{pinCode ?? "------"}</p>
          <div className="mt-5 flex justify-center">{pinCode ? <CopyButton value={pinCode} label="PIN 복사" /> : null}</div>
          <p className="mt-6 text-xs font-bold text-brand-100/55">{requiresLogin ? "QR 스캔 → 학생 로그인 → 이 세션으로 자동 복귀" : "QR 스캔 → 닉네임 입력 → 바로 참여"}</p>
          <button type="button" onClick={onStart} disabled={actionPending || registeredCount === 0} className="mt-8 inline-flex min-h-14 items-center gap-3 rounded-2xl bg-info-300 px-8 text-base font-black text-brand-950 shadow-xl shadow-info-300/15 transition hover:-translate-y-1 active:translate-y-0 disabled:translate-y-0 disabled:opacity-40"><PlayIcon className="h-5 w-5" />{actionPending ? "게임 여는 중..." : registeredCount === 0 ? "참여자를 기다리는 중" : `${registeredCount}명과 퀴즈 시작`}</button>
        </div>
      </section>
      <div className="space-y-5">
        {pinCode ? <div className="rounded-[30px] border border-white/10 bg-white p-4 text-brand-950 shadow-2xl"><JoinQrCode pin={pinCode} requiresLogin={requiresLogin} sessionId={sessionId} /></div> : null}
        <ParticipantPanel participants={participants} connectedCount={connectedCount} onKick={onKick} />
      </div>
    </div>
  );
}

function HostActiveStage({ question, liveSummary, answeredCount, participantCount, actionPending, onReveal, onNext, onEnd }: { question: LiveQuestionPayload; liveSummary: ParticipationSummary | null; answeredCount: number; participantCount: number; actionPending: boolean; onReveal: () => void; onNext: () => void; onEnd: () => void }) {
  // 슬라이드는 감상용 — 타이머·정답 공개·순위 단계 없이 호스트가 원할 때 바로 다음으로 넘어갑니다.
  if (question.type === "SLIDE") {
    const last = question.questionIndex + 1 >= question.totalQuestions;
    return <section className="animate-game-pop flex flex-1 flex-col"><div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-info-300" style={{ width: `${((question.questionIndex + 1) / question.totalQuestions) * 100}%` }} /></div><ContentSlide question={question} className="flex-1" /><div className="mt-4 text-center"><button type="button" onClick={last ? onEnd : onNext} disabled={actionPending} className="min-h-12 rounded-2xl bg-info-300 px-7 text-sm font-black text-brand-950 disabled:opacity-40">{actionPending ? "전환 중..." : last ? "퀴즈 마치기" : "다음 문제"}</button></div></section>;
  }
  const pin = question.type === "PIN_ANCHOR" || question.type === "DROP_PIN";
  const denominator = Math.max(1, participantCount, answeredCount);
  return (
    <section className="animate-game-pop flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-3 h-1.5 shrink-0 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-info-300" style={{ width: `${((question.questionIndex + 1) / question.totalQuestions) * 100}%` }} /></div>
      <div className={`grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] lg:grid-rows-1 lg:items-center ${pin ? "grid-rows-[auto_minmax(0,1fr)]" : "content-center"}`}>
        <div className="shrink-0">
          <div className="flex flex-wrap items-center gap-3"><QuestionTypeBadge type={question.type} /><PointMultiplierBadge points={question.points} /><SpeedScoreHint /></div>
          <div className="mt-5 flex items-start gap-5"><CountdownRing startedAt={question.startedAt} seconds={question.timeLimitSec} /><h1 className="max-w-4xl whitespace-pre-wrap pt-2 text-3xl font-black leading-[1.12] tracking-[-0.045em] sm:text-5xl lg:text-6xl">{question.text}</h1></div>
          {pin ? null : <QuestionMedia question={question} className="mt-5 max-h-[22dvh] w-full max-w-md" />}
        </div>
        <HostQuestionTemplate question={question} liveSummary={liveSummary} />
      </div>
      <div className="mt-3 shrink-0 rounded-[22px] border border-white/10 bg-white/[0.07] p-3 backdrop-blur-sm sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-[220px] flex-1"><div className="flex items-center justify-between text-xs font-black"><span className="text-brand-100/55">답안 제출</span><span className="font-mono text-info-200">{answeredCount} / {denominator}</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-info-300 transition-all duration-500" style={{ width: `${Math.min(100, (answeredCount / denominator) * 100)}%` }} /></div></div><button type="button" onClick={onReveal} disabled={actionPending} className="min-h-12 rounded-2xl border border-white/15 bg-white/10 px-6 text-sm font-black text-white transition hover:bg-white/15 disabled:opacity-40">{actionPending ? "집계 중..." : "지금 정답 공개"}</button></div>
        <p className="mt-3 text-[11px] font-bold text-brand-100/40">제한 시간이 끝나면 자동으로 정답 공개로 넘어갑니다.</p>
      </div>
    </section>
  );
}

function HostQuestionTemplate({ question, liveSummary }: { question: QuizQuestionPayload; liveSummary?: ParticipationSummary | null }) {
  if (question.type === "SLIDE") return <ContentSlide question={question} />;

  // 핀 유형은 응답이 없어도 배경 이미지를 띄워 둡니다. 진행 중에는 정답 영역을 그리지 않습니다 —
  // 호스트 화면이 교실 앞에 띄워져 있는 게 보통이라, 영역이 보이면 학생들이 그대로 보고 찍습니다.
  if (question.type === "PIN_ANCHOR" || question.type === "DROP_PIN") {
    if (!question.imageUrl) return <TemplateCard icon={<MapPin className="h-8 w-8" />} title="핀 고정형" description="이 문항에 이미지가 없습니다." footer="편집기에서 이미지를 올려 주세요" />;
    const livePins = liveSummary?.type === "DROP_PIN" ? liveSummary.pins.map((point) => ({ point })) : [];
    return (
      <div className="flex h-full min-h-0 flex-col rounded-[30px] border border-white/10 bg-white/[0.07] p-3 sm:p-4">
        <PinDistribution imageUrl={question.imageUrl} imageAlt={question.imageAlt ?? null} pins={livePins} fit fitMaxHeightVh={48} className="min-h-0 flex-1" />
        <p className="mt-3 text-center text-[11px] font-bold text-brand-100/50">
          {livePins.length ? `${livePins.length}명이 핀을 놓았어요` : "참가자들이 이미지 위에 핀을 놓고 있어요"}
        </p>
      </div>
    );
  }

  // 나머지 참여형은 진행 중에도 모이는 응답을 그대로 보여 줍니다. 문항의 "실시간 공개"가 꺼져
  // 있으면 서버가 집계를 보내지 않으므로 liveSummary가 계속 null이고, 안내 문구만 남습니다.
  if (isParticipationType(question.type)) {
    return (
      <div className="rounded-[30px] border border-white/10 bg-white/[0.07] p-5 sm:p-7">
        <div className="mb-4 flex items-center gap-2 text-sm font-black text-info-200"><BarChart3 className="h-5 w-5" />실시간 응답</div>
        {liveSummary?.type === "SURVEY" ? (
          <ChoiceDistributionBars question={question} breakdown={liveSummary.choiceBreakdown} correctChoiceIds={[]} />
        ) : liveSummary ? (
          <ParticipationSummaryView summary={liveSummary} question={question} />
        ) : (
          <div className="grid min-h-52 place-items-center text-center">
            <div>
              <p className="text-sm font-black text-brand-100/60">응답을 기다리는 중이에요</p>
              <p className="mt-2 text-[11px] font-bold text-brand-100/40">실시간 공개를 꺼 둔 문항이면 정답 공개 단계에서 한 번에 보여 줍니다.</p>
            </div>
          </div>
        )}
      </div>
    );
  }


  if (question.type === "SHORT_ANSWER") return <TemplateCard icon={<MessageSquareText className="h-8 w-8" />} title="단답형" description="참가자들이 직접 정답을 입력하고 있어요." footer="띄어쓰기와 대소문자를 정규화해 채점합니다" />;
  if (question.type === "NUMERIC") return <div className="rounded-[30px] border border-white/10 bg-white/[0.07] p-7 text-center"><SlidersHorizontal className="mx-auto h-8 w-8 text-info-300" /><p className="mt-4 text-xs font-black uppercase tracking-[0.18em] text-brand-100/50">Numeric range · {formatNumericStep(question.numericStep ?? 1)} 단위</p><div className="mt-7 flex items-center gap-4"><span className="font-mono text-xl font-black text-info-200">{question.numericMin ?? 0}</span><div className="relative h-3 flex-1 rounded-full bg-white/10"><div className="absolute inset-y-0 left-[15%] right-[15%] rounded-full bg-gradient-to-r from-brand-400 via-info-300 to-warning-300" /><span className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-brand-950 bg-white shadow-lg" /></div><span className="font-mono text-xl font-black text-info-200">{question.numericMax ?? 100}</span></div><p className="mt-7 text-sm font-black">가까운 답일수록 부분 점수를 받아요</p></div>;
  if (question.type === "ORDERING") return <div className="rounded-[30px] border border-white/10 bg-white/[0.07] p-5"><div className="mb-4 flex items-center gap-2 text-sm font-black text-info-200"><ListOrdered className="h-5 w-5" />순서를 바꾸는 중</div><ol className="space-y-2">{question.orderedItems.map((item, index) => <li key={`${item}-${index}`} className="animate-answer-card flex items-center gap-3 rounded-2xl border border-white/10 bg-white/10 p-3" style={{ animationDelay: `${index * 80}ms` }}><span className="grid h-9 w-9 place-items-center rounded-xl bg-info-300 font-mono text-sm font-black text-brand-950">{index + 1}</span><span className="font-black">{item}</span></li>)}</ol></div>;

  return <div className={`grid gap-3 ${question.type === "TRUE_FALSE" ? "grid-cols-2" : "sm:grid-cols-2"}`}>{question.choices.map((choice, index) => <div key={choice.id} className={`animate-answer-card min-h-28 rounded-[24px] border p-5 shadow-xl ${HOST_CHOICE_COLORS[index % HOST_CHOICE_COLORS.length]}`} style={{ animationDelay: `${index * 70}ms` }}><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/90 font-black text-brand-950">{question.type === "TRUE_FALSE" ? index === 0 ? "O" : "X" : String.fromCharCode(65 + index)}</span><p className="mt-4 whitespace-pre-wrap break-words text-lg font-black">{choice.text}</p></div>)}</div>;
}

function TemplateCard({ icon, title, description, footer }: { icon: ReactNode; title: string; description: string; footer: string }) {
  return <div className="grid min-h-72 place-items-center rounded-[30px] border border-dashed border-info-300/30 bg-info-300/[0.07] p-8 text-center"><div><span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-info-300 text-brand-950">{icon}</span><p className="mt-5 text-2xl font-black">{title}</p><p className="mt-2 text-sm font-bold text-brand-100/60">{description}</p><p className="mt-6 rounded-full bg-white/10 px-4 py-2 text-[11px] font-black text-info-200">{footer}</p></div></div>;
}

function HostRevealStage({ question, reveal, actionPending, onShowLeaderboard, onNext, onEnd }: { question: LiveQuestionPayload; reveal: LiveQuestionReveal; actionPending: boolean; onShowLeaderboard: () => void; onNext: () => void; onEnd: () => void }) {
  // 참여형은 점수가 없어 순위 단계를 건너뜁니다 — 분포를 보여준 뒤 바로 다음으로.
  const survey = isParticipationType(question.type);
  const last = question.questionIndex + 1 >= question.totalQuestions;
  const advanceButton = survey
    ? <button type="button" onClick={last ? onEnd : onNext} disabled={actionPending} className="mt-4 min-h-12 rounded-2xl bg-info-300 px-7 text-sm font-black text-brand-950 shadow-lg shadow-info-300/10 transition hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-40">{actionPending ? "전환 중..." : last ? "퀴즈 마치기" : "다음 문제"}</button>
    : null;
  if (reveal.type === "SLIDE") return <section className="animate-game-pop flex flex-1 flex-col justify-center py-3"><ContentSlide question={question} /><div className="mt-5 text-center"><button type="button" onClick={onShowLeaderboard} disabled={actionPending} className="min-h-12 rounded-2xl bg-info-300 px-7 text-sm font-black text-brand-950 disabled:opacity-40">{actionPending ? "순위 집계 중..." : "TOP 3 순위 공개"}</button></div></section>;
  const answer = revealAnswerLabel(question, reveal);
  return (
    <section className="animate-game-pop grid min-h-0 flex-1 items-center gap-5 overflow-hidden py-2 lg:grid-cols-[minmax(0,0.85fr)_minmax(420px,1.15fr)]">
      <div className="relative overflow-hidden rounded-[34px] bg-info-300 p-8 text-center text-brand-950 shadow-2xl shadow-info-300/15 sm:p-10">
        <AnswerRevealEffects />
        <div className="relative z-30"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white shadow-xl"><CheckIcon className="h-8 w-8 text-brand-700" /></span><p className="mt-5 text-xs font-black uppercase tracking-[0.24em] text-brand-800/60">Correct answer</p><h1 className="mt-4 whitespace-pre-wrap text-4xl font-black leading-tight tracking-[-0.04em] sm:text-6xl">{answer}</h1></div>
      </div>
      <div>
        <RevealDistribution question={question} reveal={reveal} />
        <div className={`mt-4 rounded-2xl border p-4 text-center ${survey ? "border-info-300/25 bg-info-400/10" : "border-warning-300/20 bg-warning-300/10"}`}>{survey ? <><p className="text-xs font-black uppercase tracking-[0.18em] text-info-200">Participation results</p><p className="mt-2 text-sm font-black">응답 분포를 함께 살펴본 뒤 넘어가세요</p>{advanceButton}</> : <><p className="text-xs font-black uppercase tracking-[0.18em] text-warning-200">Explain the answer</p><p className="mt-2 text-sm font-black">정답 설명이 끝나면 순위를 공개하세요</p><button type="button" onClick={onShowLeaderboard} disabled={actionPending} className="mt-4 min-h-12 rounded-2xl bg-info-300 px-7 text-sm font-black text-brand-950 shadow-lg shadow-info-300/10 transition hover:-translate-y-0.5 active:translate-y-0 disabled:translate-y-0 disabled:opacity-40">{actionPending ? "순위 집계 중..." : "TOP 3 순위 공개"}</button></>}</div>
      </div>
    </section>
  );
}

function revealAnswerLabel(question: QuizQuestionPayload, reveal: LiveQuestionReveal) {
  if (reveal.type === "SLIDE") return question.text;
  if (reveal.type === "SHORT_ANSWER") return reveal.acceptedAnswers.join(" / ") || "허용 정답 없음";
  if (reveal.type === "ORDERING") return reveal.correctOrder.join(" → ");
  if (reveal.type === "NUMERIC") return reveal.numericAnswer === null ? "정답 없음" : String(reveal.numericAnswer);
  if (reveal.type === "PIN_ANCHOR") return "정답 위치";
  if (reveal.type !== "SINGLE_CHOICE" && reveal.type !== "TRUE_FALSE") return PARTICIPATION_TITLES[reveal.type] ?? "모두의 응답";
  return reveal.correctChoiceIds.map((id) => question.choices.find((choice) => choice.id === id)?.text).filter(Boolean).join(" / ") || "정답 없음";
}

const PARTICIPATION_TITLES: Record<string, string> = {
  SURVEY: "정답 없는 설문",
  WORD_CLOUD: "모두가 떠올린 단어",
  DROP_PIN: "모두가 놓은 핀",
  LIKERT: "모두의 응답",
};

/** 보기별 막대 분포. 진행 중 실시간 화면과 정답 공개 화면이 같은 모양을 씁니다. */
function ChoiceDistributionBars({ question, breakdown, correctChoiceIds }: { question: QuizQuestionPayload; breakdown: { choiceId: string; count: number }[]; correctChoiceIds: string[] }) {
  const maxCount = Math.max(1, ...breakdown.map((item) => item.count));
  return <div className="space-y-3">{breakdown.map((item, index) => { const choice = question.choices.find((candidate) => candidate.id === item.choiceId); const correct = correctChoiceIds.includes(item.choiceId); return <div key={item.choiceId} className={`rounded-2xl border p-3 ${correct ? "border-info-300/40 bg-info-300/10" : "border-white/10 bg-white/5"}`}><div className="flex items-center justify-between gap-3 text-sm font-black"><span className="flex min-w-0 items-center gap-2"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[10px] ${correct ? "bg-info-300 text-brand-950" : "bg-white/10"}`}>{String.fromCharCode(65 + index)}</span><span className="truncate">{choice?.text}</span></span><span className={correct ? "text-info-200" : "text-brand-100/60"}>{item.count}명</span></div><div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full origin-left animate-[answer-bar_700ms_ease-out_both] rounded-full ${correct ? "bg-info-300" : "bg-brand-400/50"}`} style={{ width: `${(item.count / maxCount) * 100}%`, animationDelay: `${index * 80}ms` }} /></div></div>; })}</div>;
}

function DistributionPanel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-[30px] border border-white/10 bg-white/[0.07] p-5 sm:p-7"><div className="mb-5 flex items-center gap-2"><BarChart3 className="h-5 w-5 text-info-300" /><h2 className="text-sm font-black">{title}</h2></div>{children}</section>;
}

function RevealDistribution({ question, reveal }: { question: QuizQuestionPayload; reveal: LiveQuestionReveal }) {
  if (reveal.type === "SINGLE_CHOICE" || reveal.type === "TRUE_FALSE") {
    return <DistributionPanel title="응답 분포"><ChoiceDistributionBars question={question} breakdown={reveal.choiceBreakdown} correctChoiceIds={reveal.correctChoiceIds} /></DistributionPanel>;
  }

  if (reveal.type === "SURVEY") {
    return <DistributionPanel title="응답 분포">{reveal.summary?.type === "SURVEY" ? <ChoiceDistributionBars question={question} breakdown={reveal.summary.choiceBreakdown} correctChoiceIds={[]} /> : null}</DistributionPanel>;
  }

  if (reveal.type === "WORD_CLOUD" || reveal.type === "DROP_PIN" || reveal.type === "LIKERT") {
    return <DistributionPanel title="모인 응답"><ParticipationSummaryView summary={reveal.summary} question={question} /></DistributionPanel>;
  }

  if (reveal.type === "PIN_ANCHOR") {
    return (
      <DistributionPanel title="핀 분포">
        {question.imageUrl ? <PinDistribution imageUrl={question.imageUrl} imageAlt={question.imageAlt ?? null} pins={reveal.pins} areas={reveal.pinAreas} emphasizeAreas fit className="h-[min(42dvh,25rem)]" /> : null}
        <p className="mt-3 text-center text-sm font-black text-info-200">{reveal.correctCount} <span className="text-brand-100/40">/ {reveal.totalAnswered}명</span> 정답</p>
      </DistributionPanel>
    );
  }

  if ("correctCount" in reveal) return <section className="grid min-h-60 place-items-center rounded-[30px] border border-white/10 bg-white/[0.07] p-7 text-center"><div><Hash className="mx-auto h-8 w-8 text-info-300" /><p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-brand-100/50">Answer rate</p><p className="mt-3 font-mono text-5xl font-black text-info-200">{reveal.correctCount}<span className="text-2xl text-brand-100/40"> / {reveal.totalAnswered}</span></p><p className="mt-3 text-sm font-black">참가자가 정답을 맞혔어요</p></div></section>;
  return null;
}

function HostLeaderboardStage({ question, leaderboard, actionPending, onNext, onEnd }: { question: LiveQuestionPayload; leaderboard: Leaderboard; actionPending: boolean; onNext: () => void; onEnd: () => void }) {
  const lastQuestion = question.questionIndex + 1 >= question.totalQuestions;
  return (
    <section className="animate-game-pop flex flex-1 flex-col justify-center py-3">
      <LiveLeaderboard entries={leaderboard} title="현재 TOP 3" variant="stage" />
      <div className="mt-7 text-center"><button type="button" onClick={lastQuestion ? onEnd : onNext} disabled={actionPending} className={`min-h-14 rounded-2xl px-8 text-base font-black shadow-xl transition hover:-translate-y-1 active:translate-y-0 disabled:opacity-40 ${lastQuestion ? "bg-danger-400 text-white shadow-danger-400/15" : "bg-info-300 text-brand-950 shadow-info-300/15"}`}>{actionPending ? "준비 중..." : lastQuestion ? "세션 종료" : "다음 문제"}</button></div>
    </section>
  );
}

function ParticipantPanel({ participants, connectedCount, onKick }: { participants: Participant[]; connectedCount: number; onKick: (participant: Participant) => void }) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.07] backdrop-blur-sm">
      <div className="flex items-center justify-between border-b border-white/10 p-5"><div><p className="text-sm font-black">참여자</p><p className="mt-1 text-[11px] font-bold text-brand-100/45">현재 접속 {connectedCount}명</p></div><span className="flex items-center gap-2 rounded-full bg-info-300/10 px-3 py-1.5 text-xs font-black text-info-200"><UsersIcon className="h-4 w-4" />{participants.length}</span></div>
      <div className="max-h-[280px] overflow-auto p-2">{participants.length > 0 ? participants.map((participant) => <div key={participant.id} className="group flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-white/[0.07]"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-info-200 to-brand-300 text-xs font-black text-brand-950">{participant.nickname.slice(0, 1)}</div><p className="min-w-0 flex-1 truncate text-xs font-black">{participant.nickname}</p>{participant.status !== "KICKED" ? <button type="button" onClick={() => onKick(participant)} className="rounded-lg px-2 py-1 text-[10px] font-black text-brand-100/25 transition hover:bg-danger-400/15 hover:text-danger-200">내보내기</button> : <span className="text-[10px] font-bold text-danger-200/60">퇴장</span>}</div>) : <div className="py-10 text-center"><UsersIcon className="mx-auto h-6 w-6 text-brand-100/25" /><p className="mt-2 text-xs font-bold text-brand-100/40">참여자를 기다리는 중</p></div>}</div>
    </section>
  );
}
