"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useDialog } from "@/components/ui/app-dialog";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Circle, Diamond, Hexagon, MapPin, MessageSquare, Square, Star, Triangle } from "lucide-react";
import {
  AlertIcon,
  ArrowLeftIcon,
  CheckIcon,
  CopyIcon,
  GripIcon,
  ImageIcon,
  MoreIcon,
  PlayIcon,
  PlusIcon,
  PublishIcon,
  SaveIcon,
  SettingsIcon,
  TrashIcon,
  XIcon,
} from "@/components/ui/icons";
import { SubjectCombobox } from "@/components/quiz/subject-combobox";
import { InlineNotice } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { uploadQuizImage } from "@/lib/quiz/image";
import type { UploadPolicy } from "@/lib/files/upload-policy-shape";
import { insertAfter, moveItem, removeAt, selectionAfterRemoval } from "@/lib/editor/list-ops";
import { useListDrag } from "@/lib/editor/use-list-drag";
import { useDocumentSave, useFlash, type SaveContext } from "@/lib/editor/use-document-save";
import { LIKERT_DEFAULT_STEPS, LIKERT_MAX_STEPS, LIKERT_MIN_STEPS, LIKERT_PRESETS, clampLikertSteps } from "@/lib/quiz/likert";
import { autoNumericGrid, formatNumericStep } from "@/lib/quiz/numeric";
import { isParticipationType, isPinType, isUnscoredType } from "@/lib/quiz/participation";
import { parsePinAreas, pinAreaLabel, type PinArea } from "@/lib/quiz/image-pin";

// 미리보기는 실제 플레이 화면(socket.io 포함)을, 정답 영역 편집기는 이미지 좌표 도구 전체를
// 사용합니다. 둘 다 버튼을 누르기 전에는 필요 없으므로 편집기의 초기 청크에서 분리합니다.
const QuizEditorPreview = dynamic(() => import("@/components/quiz/quiz-editor-preview").then((mod) => mod.QuizEditorPreview), { ssr: false });
const PinAreaEditor = dynamic(() => import("@/components/quiz/image-pin").then((mod) => mod.PinAreaEditor), { ssr: false });

type QuestionType = "SINGLE_CHOICE" | "TRUE_FALSE" | "ORDERING" | "SHORT_ANSWER" | "NUMERIC" | "PIN_ANCHOR" | "SURVEY" | "WORD_CLOUD" | "DROP_PIN" | "LIKERT" | "SLIDE";
type SlideLayout = "CLASSIC" | "BIG_TITLE" | "TITLE_TEXT" | "BULLETS" | "QUOTE" | "BIG_MEDIA";
type AnswerPalette = "BRAND" | "SOFT" | "FOREST";
type Choice = { id?: string; text: string; isCorrect: boolean };
type Question = {
  id?: string;
  clientId: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  imageAlt: string | null;
  imagePlaceholder: string | null;
  timeLimitSec: number;
  points: number;
  multipleSelection: boolean;
  choices: Choice[];
  acceptedAnswers: string[];
  orderedItems: string[];
  numericMin: number;
  numericMax: number;
  numericAnswer: number;
  slideLayout: SlideLayout;
  slideBody: string;
  // PIN_ANCHOR 정답 영역(0~1 정규화 좌표). DROP_PIN은 정답이 없어 항상 빈 배열입니다.
  pinAreas: PinArea[];
  likertSteps: number;
  likertMinLabel: string;
  likertMaxLabel: string;
  /** 참여형 전용: 응답을 호스트 화면에 실시간으로 보여줄지. */
  revealResponsesLive: boolean;
};
type ApiQuiz = {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isPublished: boolean;
  requiresLogin: boolean;
  isSearchable: boolean;
  answerPalette: AnswerPalette;
  subject: { id: string; name: string } | null;
  availableSubjects: Array<{ id: string; name: string }>;
  accessLevel: "OWNER" | "EDITOR";
  questions: Array<Omit<Question, "clientId" | "numericMin" | "numericMax" | "numericAnswer"> & {
    id: string;
    numericMin: number | null;
    numericMax: number | null;
    numericAnswer: number | null;
  }>;
};

const QUESTION_TYPES: { value: QuestionType; label: string; short: string; description: string }[] = [
  { value: "SINGLE_CHOICE", label: "객관식", short: "객관식", description: "색과 도형 보기에서 정답을 고릅니다" },
  { value: "TRUE_FALSE", label: "O/X 참거짓", short: "O/X", description: "참인지 거짓인지 판단합니다" },
  { value: "ORDERING", label: "순서 맞추기", short: "순서", description: "항목을 올바른 순서로 배열합니다" },
  { value: "SHORT_ANSWER", label: "단답형", short: "단답", description: "학생이 직접 답을 입력합니다" },
  { value: "NUMERIC", label: "숫자 추측", short: "숫자", description: "범위 안의 숫자를 맞춥니다" },
  { value: "PIN_ANCHOR", label: "핀 고정형", short: "핀 고정", description: "이미지의 정답 위치에 핀을 고정합니다" },
  { value: "SURVEY", label: "설문", short: "설문", description: "정답 없이 의견을 모읍니다" },
  { value: "WORD_CLOUD", label: "워드 클라우드", short: "워드", description: "떠오르는 단어를 모아 크기로 보여 줍니다" },
  { value: "DROP_PIN", label: "드롭 핀", short: "드롭핀", description: "정답 없이 이미지 위 위치를 모읍니다" },
  { value: "LIKERT", label: "리커트 척도", short: "리커트", description: "동의 정도를 척도로 답합니다" },
  { value: "SLIDE", label: "미디어 슬라이드", short: "슬라이드", description: "설명과 이미지를 보여 줍니다" },
];
const SLIDE_TEMPLATES: { value: SlideLayout; label: string; description: string }[] = [
  { value: "CLASSIC", label: "클래식", description: "제목과 본문을 가운데 배치" },
  { value: "BIG_TITLE", label: "큰 제목", description: "핵심 제목을 크게 강조" },
  { value: "TITLE_TEXT", label: "제목과 텍스트", description: "제목과 설명을 균형 있게 배치" },
  { value: "BULLETS", label: "글머리 기호로 강조", description: "여러 핵심 내용을 목록으로 표현" },
  { value: "QUOTE", label: "인용구", description: "한 문장이나 인용문을 집중해서 표현" },
  { value: "BIG_MEDIA", label: "큰 미디어", description: "이미지를 크게 보여 주는 구성" },
];
const TIME_STEPS = [5, 10, 20, 30, 45, 60, 90, 120, 180, 240];
const POINT_STEPS = [0, 1000, 2000, 3000];
const ANSWER_ICONS = [Triangle, Diamond, Circle, Square, Star, Hexagon];
// 보기 6개는 색과 아이콘으로 함께 구분하되 모든 색을 pad의 역할 토큰에서 꺼냅니다. 따라서
// 라이트/다크 테마가 바뀌어도 편집기와 학생 화면이 같은 팔레트와 대비를 유지합니다.
const PALETTES: Record<AnswerPalette, { label: string; cards: string[]; chips: string[] }> = {
  BRAND: {
    label: "클래스룸 컬러",
    cards: ["bg-brand-600 text-on-brand", "bg-danger-500 text-on-brand", "bg-info-600 text-on-brand", "bg-warning-400 text-warning-950", "bg-accent-soft-fg text-on-brand", "bg-success-soft-fg text-on-brand"],
    chips: ["bg-brand-soft text-brand-soft-fg", "bg-danger-soft text-danger-soft-fg", "bg-info-soft text-info-soft-fg", "bg-warning-soft text-warning-soft-fg", "bg-accent-soft text-accent-soft-fg", "bg-success-soft text-success-soft-fg"],
  },
  SOFT: {
    label: "부드러운 컬러",
    cards: ["bg-brand-soft text-brand-soft-fg", "bg-danger-soft text-danger-soft-fg", "bg-info-soft text-info-soft-fg", "bg-warning-soft text-warning-soft-fg", "bg-accent-soft text-accent-soft-fg", "bg-success-soft text-success-soft-fg"],
    chips: ["bg-brand-200 text-brand-900", "bg-danger-200 text-danger-900", "bg-info-200 text-info-900", "bg-warning-200 text-warning-900", "bg-accent-soft text-accent-soft-fg", "bg-success-soft text-success-soft-fg"],
  },
  FOREST: {
    label: "오션",
    cards: ["bg-brand-950 text-on-brand", "bg-brand-800 text-on-brand", "bg-brand-600 text-on-brand", "bg-info-300 text-brand-950", "bg-info-600 text-white", "bg-brand-200 text-brand-950"],
    chips: ["bg-brand-100 text-brand-950", "bg-brand-200 text-brand-900", "bg-info-100 text-info-900", "bg-info-200 text-info-950", "bg-info-100 text-info-800", "bg-brand-200 text-brand-950"],
  },
};

let fallbackId = 0;
function clientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  fallbackId += 1;
  return `draft-${fallbackId}`;
}

function blankQuestion(type: QuestionType = "SINGLE_CHOICE", slideLayout: SlideLayout = "CLASSIC"): Question {
  const base: Question = {
    clientId: clientId(), type, text: "", imageUrl: null, imageAlt: null, imagePlaceholder: null,
    timeLimitSec: 20, points: 1000, multipleSelection: false, choices: [], acceptedAnswers: [], orderedItems: [],
    numericMin: 0, numericMax: 100, numericAnswer: 50, slideLayout, slideBody: "",
    pinAreas: [], likertSteps: LIKERT_DEFAULT_STEPS, likertMinLabel: LIKERT_PRESETS[0].min, likertMaxLabel: LIKERT_PRESETS[0].max,
    revealResponsesLive: true,
  };
  if (type === "SINGLE_CHOICE" || type === "SURVEY") base.choices = Array.from({ length: 4 }, () => ({ text: "", isCorrect: false }));
  if (type === "TRUE_FALSE") base.choices = [{ text: "O", isCorrect: true }, { text: "X", isCorrect: false }];
  if (type === "ORDERING") base.orderedItems = ["", "", "", ""];
  if (type === "SHORT_ANSWER") base.acceptedAnswers = [""];
  // 참여형과 슬라이드는 점수가 없습니다.
  if (isUnscoredType(type)) base.points = 0;
  return base;
}

function hydrateQuiz(raw: ApiQuiz) {
  const questions = raw.questions.map((question) => ({
    ...question,
    clientId: question.id,
    imageUrl: question.imageUrl ?? null,
    imageAlt: question.imageAlt ?? null,
    imagePlaceholder: question.imagePlaceholder ?? null,
    multipleSelection: question.multipleSelection ?? false,
    choices: question.choices ?? [],
    acceptedAnswers: question.acceptedAnswers ?? [],
    orderedItems: question.orderedItems ?? [],
    numericMin: question.numericMin ?? 0,
    numericMax: question.numericMax ?? 100,
    numericAnswer: question.numericAnswer ?? 50,
    slideLayout: question.slideLayout ?? "CLASSIC",
    slideBody: question.slideBody ?? "",
    pinAreas: parsePinAreas(question.pinAreas),
    likertSteps: clampLikertSteps(question.likertSteps),
    likertMinLabel: question.likertMinLabel ?? LIKERT_PRESETS[0].min,
    likertMaxLabel: question.likertMaxLabel ?? LIKERT_PRESETS[0].max,
    revealResponsesLive: question.revealResponsesLive ?? true,
  }));
  return {
    ...raw,
    thumbnailUrl: raw.thumbnailUrl ?? null,
    thumbnailAlt: raw.thumbnailAlt ?? null,
    subjectName: raw.subject?.name ?? "",
    answerPalette: raw.answerPalette ?? "BRAND",
    questions: questions.length ? questions : [blankQuestion()],
  };
}

function typeInfo(type: QuestionType) {
  return QUESTION_TYPES.find((entry) => entry.value === type) ?? QUESTION_TYPES[0];
}

function templateInfo(question: Question) {
  if (question.type !== "SLIDE") return typeInfo(question.type);
  const slide = SLIDE_TEMPLATES.find((entry) => entry.value === question.slideLayout) ?? SLIDE_TEMPLATES[0];
  return { value: question.type, label: slide.label, short: slide.label, description: slide.description };
}

function timeLabel(seconds: number) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}분${seconds % 60 ? ` ${seconds % 60}초` : ""}` : `${seconds}초`;
}

function pointLabel(points: number) {
  if (points === 0) return "점수 없음";
  if (points === 1000) return "기본";
  return `${points / 1000}배`;
}

// 정답 설정 패널에서 보기 목록 대신 보여 줄 안내. 유형이 늘 때마다 삼항 연산자를 잇는 대신
// 표로 두어, 빠진 유형은 기본 문구로 떨어집니다.
const ANSWER_SUMMARY_HINTS: Partial<Record<QuestionType, string>> = {
  ORDERING: "문제 화면의 위 → 아래 순서가 정답입니다.",
  SHORT_ANSWER: "대소문자와 연속 공백을 무시하고 채점합니다.",
  PIN_ANCHOR: "이미지 위에 그린 영역 안에 핀을 놓으면 정답입니다. 영역이 여러 개면 하나만 맞혀도 됩니다.",
  SURVEY: "설문 문제는 정답이 없고 응답 분포만 집계합니다.",
  WORD_CLOUD: "정답이 없습니다. 입력한 단어의 빈도로 클라우드를 그립니다.",
  DROP_PIN: "정답이 없습니다. 학생이 놓은 핀 위치만 모읍니다.",
  LIKERT: "정답이 없습니다. 눈금별 응답 수와 평균을 보여 줍니다.",
};

function AnswerShape({ index, className = "h-5 w-5" }: { index: number; className?: string }) {
  const Icon = ANSWER_ICONS[index % ANSWER_ICONS.length];
  return <Icon className={className} strokeWidth={2.4} aria-hidden="true" />;
}

function completionError(question: Question) {
  if (question.type === "SLIDE") {
    if (!question.text.trim() && !question.slideBody.trim() && !question.imageUrl && !question.imagePlaceholder) return "슬라이드에 제목, 본문 또는 이미지를 추가해 주세요.";
    return null;
  }
  if (!question.text.trim()) return "질문 내용이 비어 있습니다. 질문을 입력해 주세요.";
  if (question.type === "SINGLE_CHOICE") {
    if (question.choices.filter((choice) => choice.text.trim()).length < 2) return "보기를 두 개 이상 채워 주세요.";
    const correctCount = question.choices.filter((choice) => choice.isCorrect && choice.text.trim()).length;
    if (question.multipleSelection && correctCount < 1) return "복수 정답을 한 개 이상 지정해 주세요.";
    if (!question.multipleSelection && correctCount !== 1) return "단일 정답을 정확히 한 개 지정해 주세요.";
  }
  if (question.type === "TRUE_FALSE" && question.choices.filter((choice) => choice.isCorrect).length !== 1) return "O와 X 중 정답을 골라 주세요.";
  if (question.type === "ORDERING" && question.orderedItems.filter((item) => item.trim()).length < 2) return "순서를 맞출 항목을 두 개 이상 채워 주세요.";
  if (question.type === "ORDERING") { const items = question.orderedItems.map((item) => item.trim()).filter(Boolean); if (new Set(items).size !== items.length) return "순서 항목은 서로 다르게 입력해 주세요."; }
  if (question.type === "SHORT_ANSWER" && !question.acceptedAnswers.some((answer) => answer.trim())) return "정답을 입력해 주세요.";
  if (question.type === "NUMERIC" && (question.numericMin >= question.numericMax || question.numericAnswer < question.numericMin || question.numericAnswer > question.numericMax)) return "정답 값이 최소~최대 범위 안에 있어야 합니다.";
  if (question.type === "SURVEY" && question.choices.filter((choice) => choice.text.trim()).length < 2) return "설문 보기를 두 개 이상 채워 주세요.";
  if (isPinType(question.type) && !question.imageUrl) return "핀을 놓을 이미지를 올려 주세요.";
  if (question.type === "PIN_ANCHOR" && !question.pinAreas.length) return "이미지 위에 정답 영역을 그려 주세요.";
  if (question.type === "LIKERT" && (!question.likertMinLabel.trim() || !question.likertMaxLabel.trim())) return "척도 양 끝 라벨을 모두 입력해 주세요.";
  return null;
}

function serializeQuestion(question: Question) {
  const common = {
    ...(question.id ? { id: question.id } : {}), type: question.type, text: question.text,
    imageUrl: question.imageUrl, imageAlt: question.imageAlt, imagePlaceholder: question.imagePlaceholder,
    timeLimitSec: question.timeLimitSec, points: question.points,
  };
  if (question.type === "SINGLE_CHOICE") return { ...common, multipleSelection: question.multipleSelection, choices: question.choices };
  if (question.type === "TRUE_FALSE") return { ...common, choices: question.choices };
  if (question.type === "SURVEY") return { ...common, points: 0, choices: question.choices, revealResponsesLive: question.revealResponsesLive };
  if (question.type === "ORDERING") return { ...common, orderedItems: question.orderedItems };
  if (question.type === "SHORT_ANSWER") return { ...common, acceptedAnswers: question.acceptedAnswers };
  if (question.type === "PIN_ANCHOR") return { ...common, pinAreas: question.pinAreas };
  if (question.type === "DROP_PIN" || question.type === "WORD_CLOUD") return { ...common, points: 0, revealResponsesLive: question.revealResponsesLive };
  if (question.type === "LIKERT") return { ...common, points: 0, likertSteps: question.likertSteps, likertMinLabel: question.likertMinLabel.trim(), likertMaxLabel: question.likertMaxLabel.trim(), revealResponsesLive: question.revealResponsesLive };
  if (question.type === "SLIDE") return { ...common, points: 0, slideLayout: question.slideLayout, slideBody: question.slideBody };
  return { ...common, numericMin: question.numericMin, numericMax: question.numericMax, numericAnswer: question.numericAnswer };
}

async function responseData(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function QuizEditor({
  quizId,
  initialQuiz,
  uploadPolicy,
}: {
  quizId: string;
  initialQuiz: unknown;
  uploadPolicy: UploadPolicy;
}) {
  const dialog = useDialog();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [quiz, setQuiz] = useState<ReturnType<typeof hydrateQuiz>>(() => hydrateQuiz(initialQuiz as ApiQuiz));
  const [selected, setSelected] = useState(0);
  const [draggedOrder, setDraggedOrder] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [questionMenuOpen, setQuestionMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 발행·삭제처럼 저장이 아닌 요청이 도는 동안의 잠금입니다. 저장 자체의 잠금은 훅이 가집니다.
  const [busy, setBusy] = useState(false);
  const { message: toast, flash } = useFlash();
  // 저장 중 덮어쓰기 방지·동시 저장 방지·30초 자동 저장·나가기 경고는 공통 훅이 맡습니다
  // (lib/editor/use-document-save.ts). `saveQuiz`는 함수 선언이라 호이스팅되어 여기서 참조됩니다.
  const { dirty, saving: savingDocument, markDirty, save } = useDocumentSave({
    onSave: (context) => saveQuiz(context),
    enabled: true,
  });
  // 화면은 "지금 뭔가 진행 중인가" 하나만 보면 됩니다.
  const saving = savingDocument || busy;

  async function leaveEditor() {
    if (dirty && !(await dialog.confirm({ title: "저장하지 않고 나갈까요?", description: "저장하지 않은 변경사항이 사라집니다.", danger: true, confirmLabel: "나가기" }))) return;
    router.push("/quiz");
  }

  // Ctrl/Cmd+S는 저장 훅이 잡습니다. 여기는 편집기 고유의 Esc(열린 오버레이 닫기)만 봅니다.
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setPreviewOpen(false); setSettingsOpen(false); setQuestionMenuOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const loadedQuiz = quiz;
  const current = loadedQuiz.questions[Math.min(selected, loadedQuiz.questions.length - 1)];
  const palette = PALETTES[loadedQuiz.answerPalette];
  const doneCount = loadedQuiz.questions.filter((question) => !completionError(question)).length;
  const totalSeconds = loadedQuiz.questions.reduce((sum, question) => sum + question.timeLimitSec, 0);
  // 점수가 없는 유형(슬라이드·설문)은 가중치 합계에서 제외합니다.
  const totalPoints = loadedQuiz.questions.reduce((sum, question) => sum + (isUnscoredType(question.type) ? 0 : question.points), 0);

  function updateQuiz(fields: Partial<typeof loadedQuiz>) {
    setQuiz((value) => value ? { ...value, ...fields } : value);
    markDirty();
  }

  function updateCurrent(updater: (question: Question) => Question) {
    setQuiz((value) => value ? { ...value, questions: value.questions.map((question, index) => index === selected ? updater(question) : question) } : value);
    markDirty();
  }

  function addQuestion() {
    const question = blankQuestion();
    setQuiz((value) => value ? { ...value, questions: [...value.questions, question] } : value);
    setSelected(loadedQuiz.questions.length);
    markDirty();
  }

  // 썸네일에서 Enter를 눌렀을 때: 그 문제 "바로 아래"에 새 문제를 끼워 넣고 곧장 선택합니다.
  function insertQuestionAfter(index: number) {
    updateQuiz({ questions: insertAfter(loadedQuiz.questions, index, blankQuestion()) });
    setSelected(index + 1);
  }

  function duplicateQuestion(index = selected) {
    const source = loadedQuiz.questions[index];
    const copy: Question = {
      ...source, id: undefined, clientId: clientId(),
      choices: source.choices.map(({ text, isCorrect }) => ({ text, isCorrect })),
      acceptedAnswers: [...source.acceptedAnswers], orderedItems: [...source.orderedItems],
      // 정답 영역도 새 배열로 복사해야 복제본을 고칠 때 원본이 함께 바뀌지 않습니다.
      pinAreas: source.pinAreas.map((area) => (area.shape === "POLYGON" ? { ...area, points: [...area.points] } : { ...area })),
    };
    updateQuiz({ questions: insertAfter(loadedQuiz.questions, index, copy) });
    setSelected(index + 1);
    flash("문제를 복제했습니다.");
  }

  async function deleteQuestion(index = selected) {
    if (loadedQuiz.questions.length === 1) return flash("마지막 문제는 삭제할 수 없습니다.");
    if (!(await dialog.confirm({ title: `${index + 1}번 문제를 삭제할까요?`, description: "저장 전까지는 새로고침으로 되돌릴 수 있습니다.", danger: true, confirmLabel: "삭제" }))) return;
    const next = removeAt(loadedQuiz.questions, index);
    updateQuiz({ questions: next });
    setSelected(selectionAfterRemoval(selected, index, next.length));
    setQuestionMenuOpen(false);
  }

  function changeTemplate(type: QuestionType, slideLayout?: SlideLayout) {
    if (current.type === type && (type !== "SLIDE" || current.slideLayout === slideLayout)) return;
    const defaults = blankQuestion(type, slideLayout ?? "CLASSIC");
    updateCurrent((question) => ({
      ...defaults, id: question.id, clientId: question.clientId, text: question.text,
      imageUrl: question.imageUrl, imageAlt: question.imageAlt, imagePlaceholder: question.imagePlaceholder,
      timeLimitSec: question.timeLimitSec,
      // 점수 없는 유형으로 바꾸면 0, 점수 있는 유형으로 되돌아오면 기본 배점부터 시작합니다.
      points: isUnscoredType(type) ? 0 : isUnscoredType(question.type) ? defaults.points : question.points,
      slideBody: type === "SLIDE" && question.type === "SLIDE" ? question.slideBody : defaults.slideBody,
      // 핀 유형끼리 오갈 때는 그려 둔 정답 영역을 유지합니다(PIN_ANCHOR ↔ DROP_PIN).
      pinAreas: isPinType(type) && isPinType(question.type) ? question.pinAreas : defaults.pinAreas,
    }));
  }

  // 저장 훅이 부르는 실제 저장. 잠금·자동 저장·dirty 관리는 훅이 하고 여기서는 요청과 응답
  // 반영만 합니다. `isCurrent()`는 "요청이 도는 사이에 더 편집하지 않았는가"입니다 — false면
  // 서버 응답을 버려야 그 편집이 사라지지 않습니다.
  async function saveQuiz({ mode, isCurrent }: SaveContext): Promise<boolean> {
    const document = quiz;
    if (!document) return false;
    if (!document.title.trim()) { setError("퀴즈 제목을 입력해 주세요."); return false; }
    setError(null);
    try {
      const response = await fetch(`/api/quiz/quizzes/${quizId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.title, description: document.description?.trim() || null,
          thumbnailUrl: document.thumbnailUrl, thumbnailAlt: document.thumbnailAlt,
          requiresLogin: document.requiresLogin,
          isSearchable: document.isSearchable,
          subjectName: document.subjectName.trim() || null, answerPalette: document.answerPalette, questions: document.questions.map(serializeQuestion),
        }),
      });
      const data = await responseData(response);
      if (!response.ok || !data.quiz) {
        setError(typeof data.error === "string" ? data.error : "퀴즈를 저장하지 못했습니다.");
        return false;
      }
      const hydrated = hydrateQuiz(data.quiz as ApiQuiz);
      if (isCurrent()) {
        setQuiz(hydrated);
        setSelected((value) => Math.min(value, hydrated.questions.length - 1));
      }
      if (isCurrent() && mode === "manual") flash(`${hydrated.questions.length}개 문제를 저장했습니다.`);
      if (isCurrent() && mode === "auto") flash("변경사항을 자동 저장했습니다.");
      return true;
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 저장해 주세요.");
      return false;
    }
  }

  async function publishQuiz() {
    const incomplete = loadedQuiz.questions.findIndex((question) => completionError(question));
    if (incomplete >= 0) {
      setSelected(incomplete); setError(`${incomplete + 1}번 문제를 완성해 주세요. ${completionError(loadedQuiz.questions[incomplete])}`); return;
    }
    if (!(await save("silent"))) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/quiz/quizzes/${quizId}/publish`, { method: "POST" });
      const data = await responseData(response);
      if (!response.ok) return setError(typeof data.error === "string" ? data.error : "퀴즈를 발행하지 못했습니다.");
      setQuiz((value) => value ? { ...value, isPublished: true } : value);
      flash("퀴즈를 발행했습니다.");
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 발행해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuiz() {
    if (!(await dialog.confirm({ title: `'${loadedQuiz.title}' 퀴즈를 삭제할까요?`, description: "삭제하면 편집 중인 내용도 함께 사라집니다.", danger: true, confirmLabel: "삭제" }))) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/quiz/quizzes/${quizId}`, { method: "DELETE" });
      const data = await responseData(response);
      if (!response.ok) { setError(typeof data.error === "string" ? data.error : "퀴즈를 삭제하지 못했습니다."); return; }
      router.push("/quiz");
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 삭제해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  function moveQuestion(from: number, to: number) {
    if (from === to) return;
    updateQuiz({ questions: moveItem(loadedQuiz.questions, from, to) });
    setSelected(to);
  }

  async function onImageFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("이미지 파일만 올릴 수 있습니다.");
    try {
      // 서버가 시그니처를 검사하고 WebP로 줄여 저장한 뒤 주소를 돌려줍니다. 저장 버튼을 누르기
      // 전에도 파일은 이미 디스크에 올라가 있고, 쓰지 않고 떠난 파일은 퀴즈 저장 때 정리됩니다.
      const imageUrl = await uploadQuizImage(quizId, file, uploadPolicy);
      // 파일명은 정보가 아니라 캡션·대체텍스트로 쓰지 않습니다. alt는 표시 시 "문제 이미지"로 대체됩니다.
      updateCurrent((question) => ({ ...question, imageUrl, imageAlt: null, imagePlaceholder: null }));
      flash("문제 이미지를 추가했습니다.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "이미지를 올리지 못했습니다.");
    }
  }

  function onTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) setSelected((index) => Math.max(0, Math.min(loadedQuiz.questions.length - 1, index + (dx < 0 ? 1 : -1))));
    touchStart.current = null;
  }

  return (
    <main className="min-h-dvh bg-surface-sunken">
      <header className="sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b border-line bg-surface-sunken/95 px-3 py-2 backdrop-blur-xl lg:px-5">
        <button type="button" onClick={leaveEditor} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-content-muted transition hover:bg-surface-hover hover:text-brand" aria-label="퀴즈 목록으로 돌아가기"><ArrowLeftIcon className="h-5 w-5" /></button>
        <input value={quiz.title} onChange={(event) => updateQuiz({ title: event.target.value })} maxLength={120} aria-label="퀴즈 제목" placeholder="퀴즈 제목" className="h-11 min-w-0 max-w-sm flex-1 rounded-2xl border border-line bg-surface px-4 text-sm font-black outline-none focus:border-brand-500 lg:text-base" />
        <label className="hidden xl:block">
          <span className="sr-only">교과목</span>
          <SubjectCombobox value={quiz.subjectName} onChange={(subjectName) => updateQuiz({ subjectName })} subjects={quiz.availableSubjects} placeholder="교과목" className="w-36" inputClassName="h-11 w-full rounded-2xl border border-line bg-surface px-3 text-xs font-bold outline-none focus:border-brand-500" />
        </label>
        {/* 발행 여부와 저장 여부는 별개의 축이라 배지를 둘로 나눕니다. 예전에는 저장 배지만 있어서
            지금 이 퀴즈가 초안인지 발행본인지 편집기 어디에서도 알 수 없었습니다. */}
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <span title={loadedQuiz.isPublished ? "학생이 참여할 수 있는 상태입니다." : "아직 발행하지 않아 학생이 참여할 수 없습니다."} className={`rounded-full px-3 py-1.5 text-[11px] font-black ${loadedQuiz.isPublished ? "bg-brand-soft text-brand-soft-fg" : "bg-surface-muted text-content-muted ring-1 ring-line"}`}>{loadedQuiz.isPublished ? "발행됨" : "초안"}</span>
          <span title="변경사항은 30초마다 자동 저장됩니다." className={`rounded-full px-3 py-1.5 text-[11px] font-black ${dirty ? "bg-warning-100 text-warning-800 dark:bg-warning-400/15 dark:text-warning-300" : "bg-surface-muted text-content-muted ring-1 ring-line"}`}>
            {/* 발행은 스냅숏이 아니라 플래그(Quiz.isPublished)라, 저장하지 않은 변경이 곧
                "지금 학생이 보는 것과 다름"입니다. 발행본과의 차이를 그 말로 직접 씁니다. */}
            {dirty ? (loadedQuiz.isPublished ? "발행본과 다름" : "자동 저장 대기") : "저장됨"}
          </span>
        </span>
        <div className="flex-1" />
        <button type="button" onClick={() => setSettingsOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-content-muted" aria-label="퀴즈 설정"><SettingsIcon className="h-4.5 w-4.5" /></button>
        <button type="button" onClick={() => setPreviewOpen(true)} className="hidden min-h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-xs font-black text-content-muted sm:inline-flex"><PlayIcon className="h-4 w-4" />미리보기</button>
        {/* 저장은 Ctrl+S·30초 자동 저장·배지가 이미 받쳐 주므로 보조 버튼으로 내리고, 화면에서 가장
            강한 버튼 자리는 발행이 가져갑니다. 예전에는 저장만 강조돼 있고 발행은 톱니 → 설정 모달
            안에만 있어서, 저장을 발행으로 착각하고 "발행이 안 된다"고 하는 일이 실제로 있었습니다. */}
        <button type="button" onClick={() => void save("manual")} disabled={saving || !dirty} aria-label={saving ? "저장 중" : "퀴즈 저장"} title="저장 (Ctrl/Cmd + S)" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-xs font-black text-content-muted transition hover:border-brand-300 hover:text-brand disabled:opacity-45"><SaveIcon className="h-4 w-4" /><span className="hidden sm:inline">{saving ? "저장 중..." : "저장"}</span></button>
        <button type="button" onClick={() => void publishQuiz()} disabled={saving} aria-label={loadedQuiz.isPublished ? "변경사항 저장 후 다시 발행" : "저장 후 발행"} title={loadedQuiz.isPublished ? "저장하고 다시 발행합니다." : "저장한 뒤 학생이 참여할 수 있도록 발행합니다."} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-strong px-4 text-xs font-black text-on-brand transition hover:bg-brand-900 disabled:opacity-45"><PublishIcon className="h-4 w-4" /><span className="hidden sm:inline">{loadedQuiz.isPublished ? "다시 발행" : "발행"}</span></button>
      </header>

      {error && <div className="mx-auto w-full max-w-4xl px-4 pt-4"><InlineNotice tone="error">{error}</InlineNotice></div>}

      <div className="border-b border-line bg-surface/70 px-4 py-2 xl:hidden">
        <label className="mx-auto flex max-w-4xl items-center gap-3 text-xs font-black text-content-muted">
          <span className="shrink-0">교과목</span>
          <SubjectCombobox value={quiz.subjectName} onChange={(subjectName) => updateQuiz({ subjectName })} subjects={quiz.availableSubjects} placeholder="직접 입력 또는 선택" className="min-w-0 flex-1" inputClassName="h-10 w-full rounded-xl border border-line bg-surface px-3 text-xs font-bold text-content outline-none focus:border-brand-500" />
        </label>
      </div>

      <div className="grid min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,1fr)_310px] xl:grid-cols-[260px_minmax(0,1fr)_310px]">
        <QuestionRail
          questions={quiz.questions} selected={selected} onSelect={setSelected}
          onAdd={addQuestion} onInsertAfter={insertQuestionAfter} onDuplicate={duplicateQuestion} onDelete={deleteQuestion}
          onMove={moveQuestion}
        />

        <section
          className="min-w-0 px-4 py-5 pb-32 sm:px-6 sm:py-7 xl:pb-8"
          onTouchStart={(event) => { const touch = event.touches[0]; if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
          onTouchEnd={onTouchEnd}
        >
          <div className="mx-auto max-w-4xl">
            <div className="mb-4 flex items-center gap-2 xl:hidden">
              <span className="rounded-full bg-surface px-3 py-1.5 text-[11px] font-black text-content-muted ring-1 ring-line">문제 {selected + 1}</span>
              <span className="rounded-full bg-brand-soft px-3 py-1.5 text-[11px] font-black text-brand-soft-fg">{templateInfo(current).short}</span>
              {current.type !== "SLIDE" && <span className="rounded-full bg-surface px-3 py-1.5 text-[11px] font-black text-content-muted ring-1 ring-line">{timeLabel(current.timeLimitSec)}</span>}
              <div className="flex-1" />
              <button type="button" onClick={() => setQuestionMenuOpen(true)} className="grid h-9 w-9 place-items-center rounded-xl bg-surface text-content-muted ring-1 ring-line lg:hidden" aria-label="문제 설정"><MoreIcon className="h-5 w-5" /></button>
            </div>

            {completionError(current) && <div className="mb-4 flex items-center gap-2 rounded-2xl bg-warning-50 px-4 py-3 text-sm font-bold text-warning-900 ring-1 ring-warning-200 dark:bg-warning-400/10 dark:text-warning-200 dark:ring-warning-400/25"><AlertIcon className="h-5 w-5 shrink-0" />{completionError(current)}</div>}

            {current.type === "SLIDE" ? (
              <SlideEditor question={current} fileInput={fileInput} onFile={onImageFile} onUpdate={updateCurrent} />
            ) : (
              <>
                <textarea value={current.text} onChange={(event) => updateCurrent((question) => ({ ...question, text: event.target.value }))} maxLength={500} rows={2} placeholder="여기에 질문을 입력하세요" className="w-full resize-none rounded-[26px] border-2 border-dashed border-line bg-transparent px-5 py-6 text-center text-[clamp(1.35rem,3vw,2rem)] font-black leading-tight tracking-[-0.04em] text-content outline-none transition placeholder:text-content-subtle focus:border-brand-400 focus:bg-surface" />
                <QuestionMedia question={current} fileInput={fileInput} onFile={onImageFile} onUpdate={updateCurrent} />
                <QuestionBody question={current} palette={palette} onUpdate={updateCurrent} draggedOrder={draggedOrder} setDraggedOrder={setDraggedOrder} />
              </>
            )}
          </div>
        </section>

        <QuestionPanel
          question={current} quiz={quiz} selected={selected} doneCount={doneCount} totalSeconds={totalSeconds} totalPoints={totalPoints}
          onTemplate={changeTemplate} onUpdate={updateCurrent} onDuplicate={() => duplicateQuestion()} onDelete={() => deleteQuestion()}
        />
      </div>

      <MobileFilmstrip questions={quiz.questions} selected={selected} onSelect={setSelected} onAdd={addQuestion} onInsertAfter={insertQuestionAfter} onMove={moveQuestion} />

      {previewOpen && <QuizEditorPreview question={current} answerPalette={quiz.answerPalette} position={`${selected + 1} / ${quiz.questions.length}`} questionIndex={selected} totalQuestions={quiz.questions.length} templateLabel={templateInfo(current).label} onClose={() => setPreviewOpen(false)} />}
      {settingsOpen && <SettingsDialog quizId={quizId} quiz={quiz} uploadPolicy={uploadPolicy} doneCount={doneCount} totalSeconds={totalSeconds} totalPoints={totalPoints} onUpdate={updateQuiz} onPublish={() => void publishQuiz()} onDelete={() => void deleteQuiz()} saving={saving} onClose={() => setSettingsOpen(false)} />}
      {questionMenuOpen && <QuestionMenu question={current} onTemplate={changeTemplate} onUpdate={updateCurrent} onDuplicate={() => duplicateQuestion()} onDelete={() => deleteQuestion()} onPreview={() => { setQuestionMenuOpen(false); setPreviewOpen(true); }} onClose={() => setQuestionMenuOpen(false)} />}
      {toast && <div role="status" className="fixed bottom-28 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-scrim px-5 py-3 text-sm font-black text-white shadow-2xl lg:bottom-8">{toast}</div>}
    </main>
  );
}

// 문제 썸네일(세로 레일·가로 필름스트립) 공용 드래그 정렬. HTML5 DnD는 터치에서 동작하지 않고
// 컨테이너 가장자리 자동 스크롤도 제어할 수 없어 포인터 이벤트로 직접 구현합니다.
// - 마우스: 6px 이상 끌면 이동 시작, 그냥 클릭은 기존처럼 선택
// - 터치: 살짝 끌면 목록 스크롤 그대로, 280ms 길게 누르면 진동과 함께 이동 시작
// - 이동 중 목록 가장자리에 머무는 동안 rAF 루프가 계속 스크롤해서(깊이 넣을수록 빠르게)
//   맨 끝 카드도 드래그 한 번으로 반대쪽 끝까지 옮길 수 있습니다.
function QuestionRail({ questions, selected, onSelect, onAdd, onInsertAfter, onDuplicate, onDelete, onMove }: {
  questions: Question[]; selected: number; onSelect: (index: number) => void; onAdd: () => void; onInsertAfter: (index: number) => void;
  onDuplicate: (index: number) => void; onDelete: (index: number) => void; onMove: (from: number, to: number) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const { dragIndex, indicator, handlePointerDown, suppressClickAfterDrag, setItemRef } = useListDrag({ axis: "y", count: questions.length, listRef, onReorder: onMove });
  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] flex-col border-r border-line bg-surface/70 xl:flex">
      <ol ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
        {questions.map((question, index) => (
          <li
            key={question.clientId}
            ref={setItemRef(index)}
            onPointerDown={handlePointerDown(index)}
            onClickCapture={suppressClickAfterDrag}
            style={{ touchAction: "pan-y" }}
            className={`group relative select-none rounded-2xl border p-3 ${dragIndex === index ? "z-40 border-brand-500 bg-surface shadow-2xl" : "transition"} ${selected === index ? "border-brand-500 bg-brand-soft/40 shadow-sm" : dragIndex === index ? "" : "border-transparent bg-surface hover:border-line"}`}
          >
            {indicator === index ? (
              <span aria-hidden="true" className="pointer-events-none absolute inset-x-1 -top-[7px] z-10 flex items-center">
                <span className="h-2 w-2 shrink-0 rounded-full bg-brand shadow-[0_0_8px_rgba(48,139,221,.8)]" />
                <span className="h-1 flex-1 rounded-full bg-brand shadow-[0_0_8px_rgba(48,139,221,.6)]" />
              </span>
            ) : null}
            {indicator === questions.length && index === questions.length - 1 ? (
              <span aria-hidden="true" className="pointer-events-none absolute inset-x-1 -bottom-[7px] z-10 flex items-center">
                <span className="h-2 w-2 shrink-0 rounded-full bg-brand shadow-[0_0_8px_rgba(48,139,221,.8)]" />
                <span className="h-1 flex-1 rounded-full bg-brand shadow-[0_0_8px_rgba(48,139,221,.6)]" />
              </span>
            ) : null}
            <button type="button" onClick={() => onSelect(index)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onInsertAfter(index); } }} title="Enter: 바로 아래에 새 문제" className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <span className="flex items-center gap-2">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-black ${selected === index ? "bg-brand text-on-brand" : "bg-surface-muted text-content-muted"}`}>{index + 1}</span>
                <span className="rounded-full bg-surface-muted px-2 py-1 text-[10px] font-black text-content-muted">{templateInfo(question).short}</span>
                {completionError(question) && <AlertIcon className="ml-auto h-4 w-4 text-warning-600 dark:text-warning-400" />}
              </span>
              <span className="mt-2 line-clamp-2 block min-h-9 text-xs font-black leading-[1.45] text-content">{question.text.trim() || "내용 없음"}</span>
            </button>
            <div className="mt-2 flex items-center text-[10px] font-bold text-content-subtle">
              <span>{question.type === "SLIDE" ? "넘길 때까지 표시" : timeLabel(question.timeLimitSec)}</span>
              <div className="flex-1" />
              <button type="button" onClick={() => onDuplicate(index)} className="grid h-7 w-7 place-items-center rounded-lg hover:bg-surface-hover hover:text-brand" aria-label={`${index + 1}번 문제 복제`}><CopyIcon className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => onDelete(index)} className="grid h-7 w-7 place-items-center rounded-lg hover:bg-danger-soft hover:text-danger" aria-label={`${index + 1}번 문제 삭제`}><TrashIcon className="h-3.5 w-3.5" /></button>
            </div>
          </li>
        ))}
      </ol>
      <div className="p-3">
        <button type="button" onClick={onAdd} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-300 dark:border-brand-400/30 bg-brand-soft/40 text-xs font-black text-brand"><PlusIcon className="h-4 w-4" />추가</button>
        <p className="mt-2 text-center text-[10px] text-content-subtle">드래그로 순서 변경 · Enter로 아래에 새 문제</p>
      </div>
    </aside>
  );
}

function QuestionMedia({ question, fileInput, onFile, onUpdate }: { question: Question; fileInput: React.RefObject<HTMLInputElement | null>; onFile: (file?: File) => void; onUpdate: (updater: (question: Question) => Question) => void }) {
  const hasMedia = Boolean(question.imageUrl || question.imagePlaceholder);
  const [dragging, setDragging] = useState(false);
  const dropHandlers = {
    onDragEnter: (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(true); },
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); },
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      onFile(event.dataTransfer.files?.[0]);
    },
  };

  return (
    <div className="mt-4" {...dropHandlers}>
      {hasMedia ? (
        <div className={`relative h-52 overflow-hidden rounded-[26px] border bg-surface shadow-sm transition ${dragging ? "border-brand-500 ring-4 ring-brand-200 dark:ring-brand-400/25" : "border-line"}`}>
          {question.imageUrl ? <Image src={question.imageUrl} alt={question.imageAlt || "문제 이미지"} fill unoptimized sizes="(max-width: 1024px) 100vw, 880px" className="object-contain p-3" /> : <div className="soft-dots grid h-full place-items-center bg-brand-soft/40"><span className="rounded-full bg-surface px-4 py-2 text-xs font-black text-brand shadow-sm">{question.imagePlaceholder}</span></div>}
          {dragging && <div className="absolute inset-0 grid place-items-center bg-brand-950/75 text-sm font-black text-on-brand">여기에 놓아 사진 교체</div>}
          <button type="button" onClick={() => onUpdate((value) => ({ ...value, imageUrl: null, imageAlt: null, imagePlaceholder: null }))} className="absolute right-3 top-3 rounded-xl bg-surface/95 px-3 py-2 text-xs font-black text-danger shadow-sm">사진 삭제</button>
        </div>
      ) : (
        <div className={`flex min-h-28 flex-wrap items-center justify-center gap-2 rounded-[22px] border-2 border-dashed px-4 py-4 transition ${dragging ? "border-brand-500 bg-brand-soft" : "border-brand-200 dark:border-brand-400/25 bg-surface/70"}`}>
          <ImageIcon className="h-5 w-5 text-brand" />
          <p className="mr-2 text-xs font-bold text-content-muted">이미지를 끌어 놓거나 파일을 선택하세요</p>
          <button type="button" onClick={() => fileInput.current?.click()} className="rounded-xl bg-surface px-3 py-2 text-xs font-black text-content-muted ring-1 ring-line">파일 올리기</button>
          <button type="button" onClick={() => onUpdate((value) => ({ ...value, imagePlaceholder: "사진 자리 · 나중에 교체", imageUrl: null, imageAlt: null }))} className="rounded-xl px-3 py-2 text-xs font-black text-brand">자리표시 사진</button>
        </div>
      )}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ""; }} />
    </div>
  );
}

function SlideEditor({ question, fileInput, onFile, onUpdate }: { question: Question; fileInput: React.RefObject<HTMLInputElement | null>; onFile: (file?: File) => void; onUpdate: (updater: (question: Question) => Question) => void }) {
  const title = <textarea value={question.text} onChange={(event) => onUpdate((value) => ({ ...value, text: event.target.value }))} maxLength={500} rows={2} placeholder="슬라이드 제목" className={`w-full resize-none bg-transparent font-black leading-tight tracking-[-0.045em] text-content outline-none placeholder:text-content-subtle ${question.slideLayout === "BIG_TITLE" ? "text-left text-[clamp(2.4rem,6vw,5rem)]" : question.slideLayout === "QUOTE" ? "text-center text-base text-brand-700" : "text-center text-[clamp(1.8rem,4vw,3.4rem)]"}`} />;
  const body = <textarea value={question.slideBody} onChange={(event) => onUpdate((value) => ({ ...value, slideBody: event.target.value }))} maxLength={5000} rows={question.slideLayout === "QUOTE" ? 4 : 6} placeholder={question.slideLayout === "BULLETS" ? "핵심 내용을 줄마다 입력하세요" : question.slideLayout === "QUOTE" ? "강조할 문장이나 인용구를 입력하세요" : "설명할 내용을 입력하세요"} className={`w-full resize-none rounded-[22px] border-2 border-dashed border-line bg-surface/70 p-5 outline-none transition placeholder:text-content-subtle focus:border-brand-400 focus:bg-surface ${question.slideLayout === "QUOTE" ? "text-center text-[clamp(1.5rem,4vw,2.8rem)] font-black leading-snug" : "text-base font-bold leading-7 text-content-muted"}`} />;
  const media = <QuestionMedia question={question} fileInput={fileInput} onFile={onFile} onUpdate={onUpdate} />;

  if (question.slideLayout === "BIG_MEDIA") return <div className="rounded-[32px] border border-line bg-surface p-4 shadow-sm sm:p-6"><div className="[&>div]:mt-0 [&>div>div]:h-[min(52dvh,420px)]">{media}</div><div className="mt-5">{title}</div><div className="mt-3">{body}</div></div>;
  if (question.slideLayout === "BIG_TITLE") return <div className="grid min-h-[62dvh] items-center gap-6 rounded-[32px] border border-line bg-surface p-6 shadow-sm lg:grid-cols-[1.05fr_.95fr] lg:p-10"><div>{title}<div className="mt-5">{body}</div></div><div className="[&>div]:mt-0">{media}</div></div>;
  if (question.slideLayout === "TITLE_TEXT") return <div className="rounded-[32px] border border-line bg-surface p-6 shadow-sm lg:p-10">{title}<div className="mt-7 grid gap-5 lg:grid-cols-2"><div>{body}</div><div className="[&>div]:mt-0">{media}</div></div></div>;
  if (question.slideLayout === "BULLETS") return <div className="rounded-[32px] border border-line bg-surface p-6 shadow-sm lg:p-10">{title}<div className="mt-7 grid gap-5 lg:grid-cols-[1.15fr_.85fr]"><div><span className="mb-2 block text-[11px] font-black uppercase tracking-[0.16em] text-brand">한 줄에 한 항목</span>{body}</div><div className="[&>div]:mt-0">{media}</div></div></div>;
  if (question.slideLayout === "QUOTE") return <div className="relative flex min-h-[62dvh] flex-col items-center justify-center overflow-hidden rounded-[32px] border border-brand-200 bg-gradient-to-br from-brand-950 via-brand-900 to-info-800 p-7 shadow-xl [&_textarea]:text-white [&_textarea]:placeholder:text-brand-200/40"><span aria-hidden="true" className="absolute left-6 top-2 font-serif text-[9rem] leading-none text-info-300/20">“</span><div className="z-10 w-full max-w-3xl">{body}<div className="mx-auto mt-5 max-w-xl">{title}</div></div></div>;
  return <div className="flex min-h-[62dvh] flex-col justify-center rounded-[32px] border border-line bg-surface p-6 shadow-sm lg:p-10">{title}<div className="mx-auto mt-4 w-full max-w-3xl">{body}</div><div className="mx-auto w-full max-w-3xl">{media}</div></div>;
}

function TemplateGlyph({ type, slideLayout, className = "h-14 w-full" }: { type: QuestionType; slideLayout?: SlideLayout; className?: string }) {
  const ink = "currentColor";
  if (type === "SLIDE") {
    const layout = slideLayout ?? "CLASSIC";
    return <svg viewBox="0 0 112 64" className={className} fill="none" aria-hidden="true"><rect x="1" y="1" width="110" height="62" rx="8" fill="white" stroke="currentColor" strokeOpacity=".18" />
      {layout === "CLASSIC" && <><rect x="28" y="12" width="56" height="6" rx="3" fill={ink} /><rect x="36" y="23" width="40" height="3" rx="1.5" fill={ink} opacity=".35" /><rect x="27" y="33" width="58" height="21" rx="5" fill={ink} opacity=".16" /></>}
      {layout === "BIG_TITLE" && <><rect x="10" y="14" width="52" height="9" rx="3" fill={ink} /><rect x="10" y="29" width="43" height="4" rx="2" fill={ink} opacity=".35" /><rect x="70" y="10" width="32" height="44" rx="6" fill={ink} opacity=".16" /></>}
      {layout === "TITLE_TEXT" && <><rect x="12" y="10" width="50" height="7" rx="3" fill={ink} /><rect x="12" y="27" width="42" height="4" rx="2" fill={ink} opacity=".38" /><rect x="12" y="36" width="36" height="4" rx="2" fill={ink} opacity=".28" /><rect x="65" y="25" width="36" height="29" rx="5" fill={ink} opacity=".16" /></>}
      {layout === "BULLETS" && <><rect x="12" y="9" width="54" height="7" rx="3" fill={ink} />{[27, 38, 49].map((y) => <g key={y}><circle cx="17" cy={y} r="2.5" fill={ink} /><rect x="24" y={y - 2} width="34" height="4" rx="2" fill={ink} opacity=".36" /></g>)}<rect x="69" y="23" width="32" height="32" rx="5" fill={ink} opacity=".16" /></>}
      {layout === "QUOTE" && <><text x="15" y="32" fill={ink} opacity=".3" fontSize="28" fontWeight="900">“</text><rect x="33" y="20" width="59" height="5" rx="2.5" fill={ink} /><rect x="27" y="31" width="67" height="5" rx="2.5" fill={ink} opacity=".7" /><rect x="43" y="45" width="34" height="3" rx="1.5" fill={ink} opacity=".3" /></>}
      {layout === "BIG_MEDIA" && <><rect x="9" y="7" width="94" height="40" rx="6" fill={ink} opacity=".17" /><path d="m22 39 17-15 12 10 12-8 23 13" stroke={ink} strokeWidth="3" opacity=".45" /><circle cx="82" cy="18" r="5" fill={ink} opacity=".42" /><rect x="27" y="52" width="58" height="5" rx="2.5" fill={ink} /></>}
    </svg>;
  }
  return <svg viewBox="0 0 112 64" className={className} fill="none" aria-hidden="true"><rect x="1" y="1" width="110" height="62" rx="8" fill="white" stroke="currentColor" strokeOpacity=".18" /><rect x="23" y="9" width="66" height="6" rx="3" fill={ink} />
    {type === "SINGLE_CHOICE" && <>{[[10, 25], [59, 25], [10, 44], [59, 44]].map(([x, y], index) => <g key={index}><rect x={x} y={y} width="43" height="13" rx="4" fill={ink} opacity={index === 0 ? ".48" : ".18"} /><circle cx={x + 7} cy={y + 6.5} r="2.5" fill={ink} /></g>)}</>}
    {type === "TRUE_FALSE" && <><rect x="10" y="24" width="43" height="31" rx="6" fill={ink} opacity=".2" /><circle cx="31.5" cy="39.5" r="9" stroke={ink} strokeWidth="4" /><rect x="59" y="24" width="43" height="31" rx="6" fill={ink} opacity=".2" /><path d="m72 31 17 17m0-17L72 48" stroke={ink} strokeWidth="4" strokeLinecap="round" /></>}
    {type === "ORDERING" && <>{[25, 36, 47].map((y, index) => <g key={y}><circle cx="20" cy={y} r="5" fill={ink} opacity=".22" /><text x="20" y={y + 2.5} textAnchor="middle" fontSize="7" fontWeight="900" fill={ink}>{index + 1}</text><rect x="31" y={y - 3} width={58 - index * 7} height="6" rx="3" fill={ink} opacity=".34" /></g>)}</>}
    {type === "SHORT_ANSWER" && <><rect x="13" y="28" width="86" height="20" rx="6" stroke={ink} strokeWidth="2" opacity=".35" /><path d="m25 40 8-8 4 4-8 8-6 2 2-6Z" fill={ink} /></>}
    {type === "NUMERIC" && <><path d="M15 40h82" stroke={ink} strokeWidth="5" strokeLinecap="round" opacity=".22" /><circle cx="66" cy="40" r="9" fill={ink} /><text x="16" y="56" fontSize="7" fontWeight="800" fill={ink}>0</text><text x="92" y="56" fontSize="7" fontWeight="800" fill={ink}>100</text></>}
    {type === "SURVEY" && <>{[25, 35, 45, 55].map((y, index) => <g key={y}><rect x="18" y={y - 3} width={18 + index * 12} height="6" rx="3" fill={ink} opacity={.22 + index * .09} /><circle cx="12" cy={y} r="2.5" fill={ink} /></g>)}</>}
    {type === "PIN_ANCHOR" && <><rect x="12" y="20" width="88" height="40" rx="5" fill={ink} opacity=".14" /><rect x="52" y="28" width="30" height="22" rx="4" fill={ink} opacity=".3" stroke={ink} strokeWidth="1.6" /><path d="M64 46c0-5 4-9 9-9s9 4 9 9c0 6-9 14-9 14s-9-8-9-14Z" fill={ink} /><circle cx="73" cy="46" r="3" fill="white" /></>}
    {type === "WORD_CLOUD" && <><text x="14" y="34" fontSize="13" fontWeight="900" fill={ink} opacity=".85">단어</text><text x="56" y="30" fontSize="8" fontWeight="800" fill={ink} opacity=".45">생각</text><text x="20" y="50" fontSize="7" fontWeight="800" fill={ink} opacity=".35">의견</text><text x="52" y="52" fontSize="11" fontWeight="900" fill={ink} opacity=".65">모음</text></>}
    {type === "DROP_PIN" && <><rect x="12" y="20" width="88" height="40" rx="5" fill={ink} opacity=".14" /><path d="M38 40c0-4 3-7 7-7s7 3 7 7c0 5-7 11-7 11s-7-6-7-11Z" fill={ink} opacity=".75" /><path d="M64 32c0-3 3-6 6-6s6 3 6 6c0 4-6 9-6 9s-6-5-6-9Z" fill={ink} opacity=".5" /><path d="M78 50c0-3 2-5 5-5s5 2 5 5c0 3-5 8-5 8s-5-5-5-8Z" fill={ink} opacity=".35" /></>}
    {type === "LIKERT" && <>{[0, 1, 2, 3, 4].map((index) => <rect key={index} x={16 + index * 17} y={48 - index * 6} width="12" height={6 + index * 6} rx="2" fill={ink} opacity={.25 + index * .13} />)}<path d="M14 58h86" stroke={ink} strokeWidth="1.6" opacity=".3" /></>}
  </svg>;
}

function TemplatePicker({ question, onSelect }: { question: Question; onSelect: (type: QuestionType, slideLayout?: SlideLayout) => void }) {
  const [open, setOpen] = useState(false);
  const current = templateInfo(question);
  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  function choose(type: QuestionType, slideLayout?: SlideLayout) {
    onSelect(type, slideLayout);
    setOpen(false);
  }
  return <div className="relative mt-2"><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2.5 text-left transition hover:border-brand-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"><span className="grid h-11 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-soft/40 px-1 text-brand-900"><TemplateGlyph type={question.type} slideLayout={question.slideLayout} className="h-10 w-full" /></span><span className="min-w-0"><span className="block text-sm font-black text-content">{current.label}</span><span className="mt-0.5 line-clamp-1 block text-[10px] font-bold text-content-subtle">{current.description}</span></span><svg viewBox="0 0 20 20" className={`ml-auto h-4 w-4 shrink-0 text-content-subtle transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg></button>
    {open && <><button type="button" className="fixed inset-0 z-[80] cursor-default bg-scrim/25 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-label="템플릿 선택 닫기" /><div role="dialog" aria-label="템플릿 선택" className="fixed inset-x-4 bottom-4 top-20 z-[90] overflow-y-auto rounded-[24px] border border-line bg-surface p-4 shadow-2xl sm:left-auto sm:right-6 sm:w-[42rem] lg:bottom-auto lg:right-[330px] lg:max-h-[calc(100dvh-7rem)]"><div className="flex items-center"><p className="text-sm font-black text-content">템플릿 선택</p><div className="flex-1" /><button type="button" onClick={() => setOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-content-subtle hover:bg-surface-muted" aria-label="닫기"><XIcon className="h-4 w-4" /></button></div><p className="mt-3 text-[11px] font-black uppercase tracking-[0.14em] text-content-subtle">퀴즈 템플릿</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{QUESTION_TYPES.filter((entry) => entry.value !== "SLIDE" && !isParticipationType(entry.value)).map((entry) => <TemplateOption key={entry.value} selected={question.type === entry.value} label={entry.label} description={entry.description} glyph={<TemplateGlyph type={entry.value} />} onClick={() => choose(entry.value)} />)}</div><div className="my-4 h-px bg-line" /><p className="text-[11px] font-black uppercase tracking-[0.14em] text-content-subtle">참여 · 점수 없음</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{QUESTION_TYPES.filter((entry) => isParticipationType(entry.value)).map((entry) => <TemplateOption key={entry.value} selected={question.type === entry.value} label={entry.label} description={entry.description} glyph={<TemplateGlyph type={entry.value} />} onClick={() => choose(entry.value)} />)}</div><div className="my-4 h-px bg-line" /><p className="text-[11px] font-black uppercase tracking-[0.14em] text-brand">미디어 슬라이드</p><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{SLIDE_TEMPLATES.map((entry) => <TemplateOption key={entry.value} selected={question.type === "SLIDE" && question.slideLayout === entry.value} label={entry.label} description={entry.description} glyph={<TemplateGlyph type="SLIDE" slideLayout={entry.value} />} onClick={() => choose("SLIDE", entry.value)} />)}</div></div></>}
  </div>;
}

function TemplateOption({ selected, label, description, glyph, onClick }: { selected: boolean; label: string; description: string; glyph: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={selected} className={`rounded-2xl border p-2 text-left transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md ${selected ? "border-brand-500 bg-brand-soft/40 ring-1 ring-brand-500" : "border-line bg-surface-muted/70"}`}><span className="block overflow-hidden rounded-xl bg-surface px-1 text-brand-950">{glyph}</span><span className="mt-2 block text-xs font-black text-content">{label}</span><span className="mt-0.5 line-clamp-1 block text-[9px] font-bold text-content-subtle">{description}</span></button>;
}

// 눈금이 이 개수를 넘어가면 미리보기 막대에 눈금선을 그리지 않습니다. 촘촘하게 찍으면 회색 띠로
// 뭉개져서 "단위가 얼마나 잘게 쪼개졌는지"를 오히려 덜 보여 줍니다.
const NUMERIC_TICK_LIMIT = 41;

function NumericEditor({ question, onUpdate }: { question: Question; onUpdate: (updater: (question: Question) => Question) => void }) {
  const { numericMin, numericMax, numericAnswer } = question;
  const span = numericMax - numericMin;
  // 눈금은 교사가 고르지 않습니다. 범위와 정답만 넣으면 정답을 기준점으로 자동으로 쪼개고,
  // 슬라이더 양 끝도 눈금에 맞춰 당깁니다.
  const { step, intervals, gridMin, gridMax } = autoNumericGrid(numericMin, numericMax, numericAnswer);
  const stopCount = intervals + 1;
  // 편집 중에 잠깐 뒤집힌 범위(최소 > 최대)가 되어도 미리보기가 깨지지 않도록 0~100%로 가둡니다.
  const percentOf = (value: number) => Math.max(0, Math.min(100, span > 0 ? (value - numericMin) / span * 100 : 0));
  const ticks = stopCount >= 2 && stopCount <= NUMERIC_TICK_LIMIT
    ? Array.from({ length: stopCount }, (_, index) => percentOf(gridMin + index * step))
    : [];

  return <div className="mx-auto mt-7 max-w-2xl rounded-[26px] border border-line bg-surface p-5 shadow-sm">
    <div className="relative mb-8 mt-3 h-3 rounded-full bg-brand-soft">
      {ticks.map((left, index) => <span key={index} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 rounded-full bg-brand/30" style={{ left: `${left}%` }} />)}
      <div className="absolute top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-surface bg-brand shadow-md" style={{ left: `${percentOf(numericAnswer)}%` }} />
    </div>
    <div className="grid grid-cols-3 gap-3">
      {(["numericMin", "numericAnswer", "numericMax"] as const).map((field) => <label key={field} className="text-center text-xs font-black text-content-muted">{field === "numericMin" ? "최소" : field === "numericMax" ? "최대" : "정답"}<input type="number" value={question[field]} onChange={(event) => onUpdate((value) => ({ ...value, [field]: Number(event.target.value) }))} className={`mt-2 h-12 w-full rounded-xl border px-2 text-center text-sm font-black outline-none ${field === "numericAnswer" ? "border-brand-400 bg-brand-soft/40 text-brand-soft-fg" : "border-line bg-surface-muted"}`} /></label>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-surface-muted px-4 py-3 text-[11px] font-bold text-content-muted">
      <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-black text-brand-soft-fg">자동 {formatNumericStep(step)} 단위</span>
      {span > 0
        ? <span>학생 슬라이더는 <b className="font-black text-content">{gridMin}~{gridMax}</b>를 <b className="font-black text-content">{stopCount}칸</b> 눈금으로 고르고, 정답 {numericAnswer}은 눈금 위에 정확히 놓입니다.</span>
        : <span>최솟값을 최댓값보다 작게 맞춰 주세요.</span>}
    </div>
    <p className="mt-3 text-center text-[11px] text-content-subtle">정답에 가까울수록 더 높은 점수를 받습니다.</p>
  </div>;
}

function QuestionBody({ question, palette, onUpdate, draggedOrder, setDraggedOrder }: { question: Question; palette: (typeof PALETTES)[AnswerPalette]; onUpdate: (updater: (question: Question) => Question) => void; draggedOrder: number | null; setDraggedOrder: (index: number | null) => void }) {
  if (question.type === "SINGLE_CHOICE" || question.type === "SURVEY") return <ChoiceEditor question={question} palette={palette} onUpdate={onUpdate} />;
  if (question.type === "TRUE_FALSE") return <div className="mt-4 grid gap-3 sm:grid-cols-2">{question.choices.map((choice, index) => <button key={index} type="button" onClick={() => onUpdate((value) => ({ ...value, choices: value.choices.map((entry, choiceIndex) => ({ ...entry, isCorrect: choiceIndex === index })) }))} className={`min-h-28 rounded-[24px] p-5 text-2xl font-black shadow-sm transition ${palette.cards[index]} ${choice.isCorrect ? "ring-4 ring-brand-950 ring-offset-4 dark:ring-offset-surface-sunken" : "opacity-75 hover:opacity-100"}`}>{choice.text}<span className="mt-2 block text-xs opacity-80">{choice.isCorrect ? "정답" : "눌러서 정답 지정"}</span></button>)}</div>;
  if (question.type === "ORDERING") return <div className="mt-5 space-y-2"><p className="mb-3 text-center text-xs font-bold text-content-muted">끌어서 정답 순서를 정하세요. 학생에게는 섞어서 보여 줍니다.</p>{question.orderedItems.map((item, index) => <div key={index} draggable onDragStart={() => setDraggedOrder(index)} onDragEnd={() => setDraggedOrder(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggedOrder === null || draggedOrder === index) return; onUpdate((value) => ({ ...value, orderedItems: moveItem(value.orderedItems, draggedOrder, index) })); setDraggedOrder(null); }} className={`flex items-center gap-3 rounded-2xl border border-line bg-surface p-2 shadow-sm ${draggedOrder === index ? "opacity-40" : ""}`}><GripIcon className="h-5 w-5 shrink-0 text-content-subtle" /><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-xs font-black text-brand-soft-fg">{index + 1}</span><input value={item} onChange={(event) => onUpdate((value) => ({ ...value, orderedItems: value.orderedItems.map((entry, itemIndex) => itemIndex === index ? event.target.value : entry) }))} maxLength={200} placeholder="항목 내용" className="h-11 min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-content-subtle" /><button type="button" disabled={question.orderedItems.length <= 2} onClick={() => onUpdate((value) => ({ ...value, orderedItems: value.orderedItems.filter((_, itemIndex) => itemIndex !== index) }))} className="grid h-9 w-9 place-items-center rounded-xl text-content-subtle hover:bg-danger-soft hover:text-danger disabled:opacity-25" aria-label={`${index + 1}번 항목 삭제`}><TrashIcon className="h-4 w-4" /></button></div>)}{question.orderedItems.length < 10 && <button type="button" onClick={() => onUpdate((value) => ({ ...value, orderedItems: [...value.orderedItems, ""] }))} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-brand"><PlusIcon className="h-4 w-4" />항목 추가</button>}</div>;
  if (question.type === "SHORT_ANSWER") return <div className="mx-auto mt-6 max-w-xl space-y-3 text-center"><p className="text-xs font-bold text-content-muted">학생이 직접 답을 입력합니다</p><input value={question.acceptedAnswers[0] ?? ""} onChange={(event) => onUpdate((value) => ({ ...value, acceptedAnswers: [event.target.value, ...value.acceptedAnswers.slice(1)] }))} maxLength={200} placeholder="정답을 입력하세요" className="h-16 w-full rounded-2xl border-2 border-brand-400 bg-brand-soft/40 px-5 text-center text-xl font-black text-brand-soft-fg outline-none focus:bg-surface" /><input value={question.acceptedAnswers.slice(1).join(", ")} onChange={(event) => onUpdate((value) => ({ ...value, acceptedAnswers: [value.acceptedAnswers[0] ?? "", ...event.target.value.split(",").map((answer) => answer.trimStart()).slice(0, 9)] }))} placeholder="대체 정답 (쉼표로 구분)" className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-center text-sm outline-none focus:border-brand-400" /><p className="text-[11px] text-content-subtle">대소문자와 연속 공백은 구분하지 않습니다.</p></div>;
  if (isPinType(question.type)) return <PinQuestionEditor question={question} onUpdate={onUpdate} />;
  if (question.type === "WORD_CLOUD") return <WordCloudEditor />;
  if (question.type === "LIKERT") return <LikertEditor question={question} onUpdate={onUpdate} />;
  return <NumericEditor question={question} onUpdate={onUpdate} />;
}

/**
 * 핀 유형의 본문. 이미지는 공통 문항 이미지(imageUrl)를 그대로 쓰므로 별도 업로더를 두지 않고,
 * 질문 영역에 이미 크게 보이고 있습니다 — 여기서 한 번 더 그리면 같은 이미지가 두 번 보입니다.
 *
 * 핀 고정형(PIN_ANCHOR)만 정답 영역이 필요합니다. 영역 그리기는 본문에 펼쳐 두는 대신 별도 창에서
 * 합니다. 편집 화면 안에서는 그림이 작아 세밀하게 그리기 어렵고, 문항 목록을 오갈 때마다
 * 캔버스가 다시 그려져 실수로 선이 그어지는 일도 있었습니다.
 */
function PinQuestionEditor({ question, onUpdate }: { question: Question; onUpdate: (updater: (question: Question) => Question) => void }) {
  const [areaDialogOpen, setAreaDialogOpen] = useState(false);

  if (question.type === "DROP_PIN") {
    return (
      <div className="mx-auto mt-6 max-w-xl rounded-2xl bg-surface-muted p-6 text-center">
        <MapPin className="mx-auto h-8 w-8 text-content-subtle" aria-hidden="true" />
        <p className="mt-3 text-sm font-black text-content">
          {question.imageUrl ? "학생이 이미지 위에 핀을 놓습니다" : "먼저 이미지를 올려 주세요"}
        </p>
        <p className="mt-2 text-xs font-bold leading-5 text-content-muted">
          {question.imageUrl
            ? "정답이 없는 참여형입니다. 모인 핀은 진행 화면과 결과에서 이미지 위에 함께 표시됩니다."
            : "위쪽 질문 영역의 이미지 버튼으로 배경 이미지를 추가해 주세요."}
        </p>
      </div>
    );
  }

  if (!question.imageUrl) {
    return (
      <div className="mx-auto mt-6 max-w-xl rounded-2xl border-2 border-dashed border-line p-8 text-center">
        <MapPin className="mx-auto h-8 w-8 text-content-subtle" aria-hidden="true" />
        <p className="mt-3 text-sm font-black text-content">먼저 이미지를 올려 주세요</p>
        <p className="mt-2 text-xs font-bold text-content-muted">위쪽 질문 영역의 이미지 버튼으로 배경 이미지를 추가하면 정답 영역을 지정할 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-xl">
      <div className={`rounded-2xl p-6 text-center ${question.pinAreas.length ? "bg-brand-soft/40" : "border-2 border-dashed border-line"}`}>
        <MapPin className={`mx-auto h-8 w-8 ${question.pinAreas.length ? "text-brand" : "text-content-subtle"}`} aria-hidden="true" />
        <p className="mt-3 text-sm font-black text-content">
          {question.pinAreas.length ? `정답 영역 ${question.pinAreas.length}개를 지정했습니다` : "정답 영역이 아직 없습니다"}
        </p>
        {question.pinAreas.length ? (
          <ul className="mt-3 flex flex-wrap justify-center gap-1.5">
            {question.pinAreas.map((area, index) => (
              <li key={index} className="rounded-lg bg-surface px-2.5 py-1 text-[11px] font-black text-content-muted">{pinAreaLabel(area)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs font-bold text-content-muted">학생이 핀을 놓아야 할 위치를 이미지 위에 그려 주세요.</p>
        )}
        <button
          type="button"
          onClick={() => setAreaDialogOpen(true)}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-strong px-5 text-sm font-black text-on-brand transition hover:bg-brand-900"
        >
          <MapPin className="h-4 w-4" />
          {question.pinAreas.length ? "정답 영역 수정" : "정답 영역 지정"}
        </button>
      </div>

      {areaDialogOpen && (
        <DialogShell title="정답 영역 지정" onClose={() => setAreaDialogOpen(false)} wide>
          <PinAreaEditor
            imageUrl={question.imageUrl}
            imageAlt={question.imageAlt}
            areas={question.pinAreas}
            onChange={(pinAreas) => onUpdate((value) => ({ ...value, pinAreas }))}
          />
          <div className="mt-5 flex justify-end">
            <button type="button" onClick={() => setAreaDialogOpen(false)} className="min-h-11 rounded-xl bg-brand-strong px-6 text-sm font-black text-on-brand transition hover:bg-brand-900">완료</button>
          </div>
        </DialogShell>
      )}
    </div>
  );
}

function WordCloudEditor() {
  return (
    <div className="mx-auto mt-6 max-w-xl rounded-2xl bg-surface-muted p-6 text-center">
      <MessageSquare className="mx-auto h-8 w-8 text-content-subtle" aria-hidden="true" />
      <p className="mt-3 text-sm font-black text-content">학생이 자유롭게 단어를 입력합니다</p>
      <p className="mt-2 text-xs font-bold leading-5 text-content-muted">
        입력한 문장을 단어로 나눠 빈도를 세고, 많이 나온 단어일수록 크고 진하게 보여 줍니다.
        한 사람이 같은 단어를 여러 번 써도 1명으로 셉니다.
      </p>
    </div>
  );
}

function LikertEditor({ question, onUpdate }: { question: Question; onUpdate: (updater: (question: Question) => Question) => void }) {
  const activePreset = LIKERT_PRESETS.find((preset) => preset.min === question.likertMinLabel && preset.max === question.likertMaxLabel);
  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-5">
      <div>
        <p className="text-xs font-black text-content-muted">라벨 유형</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {LIKERT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onUpdate((value) => ({ ...value, likertMinLabel: preset.min, likertMaxLabel: preset.max }))}
              className={`min-h-10 rounded-xl px-3 text-xs font-black transition ${activePreset?.id === preset.id ? "bg-brand-strong text-on-brand" : "bg-surface-muted text-content-muted hover:text-brand"}`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] font-semibold text-content-subtle">아래에서 직접 고쳐 쓸 수도 있습니다.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs font-black text-content-muted">
          왼쪽 끝 (1점)
          <input value={question.likertMinLabel} onChange={(event) => onUpdate((value) => ({ ...value, likertMinLabel: event.target.value }))} maxLength={40} placeholder="예: 매우 불만" className="h-12 rounded-xl border border-line bg-surface px-3 text-sm font-bold outline-none focus:border-brand-400" />
        </label>
        <label className="grid gap-1.5 text-xs font-black text-content-muted">
          오른쪽 끝 ({question.likertSteps}점)
          <input value={question.likertMaxLabel} onChange={(event) => onUpdate((value) => ({ ...value, likertMaxLabel: event.target.value }))} maxLength={40} placeholder="예: 매우 만족" className="h-12 rounded-xl border border-line bg-surface px-3 text-sm font-bold outline-none focus:border-brand-400" />
        </label>
      </div>

      <div>
        <p className="text-xs font-black text-content-muted">눈금 수</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Array.from({ length: LIKERT_MAX_STEPS - LIKERT_MIN_STEPS + 1 }, (_, index) => LIKERT_MIN_STEPS + index).map((steps) => (
            <button
              key={steps}
              type="button"
              onClick={() => onUpdate((value) => ({ ...value, likertSteps: steps }))}
              className={`min-h-10 w-11 rounded-xl text-sm font-black tabular-nums transition ${question.likertSteps === steps ? "bg-brand-strong text-on-brand" : "bg-surface-muted text-content-muted hover:text-brand"}`}
            >
              {steps}
            </button>
          ))}
        </div>
      </div>

      {/* 학생에게 보일 모습 미리보기 — 라벨과 눈금 수가 실제로 어떻게 배치되는지 바로 확인합니다. */}
      <div className="rounded-2xl bg-surface-muted p-4">
        <div className="flex items-center justify-between gap-3 text-[11px] font-black text-content-muted">
          <span className="max-w-[45%] text-left">{question.likertMinLabel || "왼쪽 라벨"}</span>
          <span className="max-w-[45%] text-right">{question.likertMaxLabel || "오른쪽 라벨"}</span>
        </div>
        <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${question.likertSteps}, minmax(0, 1fr))` }}>
          {Array.from({ length: question.likertSteps }, (_, index) => (
            <div key={index} className="grid min-h-11 place-items-center rounded-xl border border-line bg-surface text-sm font-black text-content-muted">{index + 1}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 참여형 전용: 응답을 호스트 화면에 실시간으로 보여줄지. 끄면 정답 공개 단계에서 한 번에
 * 드러납니다 — 먼저 답한 사람의 응답이 뒤에 답하는 사람에게 영향을 주는 걸 막고 싶을 때 씁니다.
 * 채점형에는 이 선택지가 없습니다(공개 전 분포가 보이면 그 자체가 정답 힌트라서).
 */
function LiveRevealToggle({ question, onUpdate, className = "" }: { question: Question; onUpdate: (updater: (question: Question) => Question) => void; className?: string }) {
  if (!isParticipationType(question.type)) return null;
  const on = question.revealResponsesLive;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onUpdate((value) => ({ ...value, revealResponsesLive: !value.revealResponsesLive }))}
      className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${on ? "border-brand-300 bg-brand-soft/40" : "border-line bg-surface-muted"} ${className}`}
    >
      <span className={`mt-0.5 grid h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition ${on ? "bg-brand-strong" : "bg-line-strong"}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow transition ${on ? "translate-x-4" : "translate-x-0"}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-black text-content">응답 실시간 공개</span>
        <span className="mt-0.5 block text-[11px] font-semibold leading-4 text-content-muted">
          {on ? "응답이 들어오는 대로 진행 화면에 보여 줍니다." : "진행 중에는 감추고 정답 공개 단계에서 한 번에 보여 줍니다."}
        </span>
      </span>
    </button>
  );
}

function AutoGrowTextarea({ value, onChange, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; onChange: React.ChangeEventHandler<HTMLTextAreaElement> }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);
  return <textarea {...props} ref={textareaRef} value={value} onChange={onChange} rows={1} />;
}

function ChoiceEditor({ question, palette, onUpdate }: { question: Question; palette: (typeof PALETTES)[AnswerPalette]; onUpdate: (updater: (question: Question) => Question) => void }) {
  function setMultipleSelection(multipleSelection: boolean) {
    onUpdate((value) => {
      const firstCorrect = value.choices.findIndex((choice) => choice.isCorrect);
      return {
        ...value,
        multipleSelection,
        choices: multipleSelection
          ? value.choices
          : value.choices.map((choice, index) => ({ ...choice, isCorrect: index === (firstCorrect >= 0 ? firstCorrect : 0) })),
      };
    });
  }

  function setCorrect(index: number, checked: boolean) {
    onUpdate((value) => ({
      ...value,
      choices: value.choices.map((choice, choiceIndex) => ({
        ...choice,
        isCorrect: value.multipleSelection ? choiceIndex === index ? checked : choice.isCorrect : choiceIndex === index,
      })),
    }));
  }

  return (
    <div className="mt-4">
      {question.type === "SINGLE_CHOICE" && (
        <fieldset className="mb-4 flex items-center justify-center gap-2">
          <legend className="sr-only">정답 선택 방식</legend>
          <button type="button" onClick={() => setMultipleSelection(false)} aria-pressed={!question.multipleSelection} className={`rounded-full px-4 py-2 text-xs font-black transition ${!question.multipleSelection ? "bg-brand-strong text-on-brand" : "bg-surface text-content-muted ring-1 ring-line"}`}>단일 정답</button>
          <button type="button" onClick={() => setMultipleSelection(true)} aria-pressed={question.multipleSelection} className={`rounded-full px-4 py-2 text-xs font-black transition ${question.multipleSelection ? "bg-brand-strong text-on-brand" : "bg-surface text-content-muted ring-1 ring-line"}`}>복수 정답</button>
        </fieldset>
      )}
      <div className="grid items-start gap-3 sm:grid-cols-2">
        {question.choices.map((choice, index) => (
          <div key={choice.id ?? index} className={`flex min-h-24 items-start gap-3 rounded-[24px] p-4 shadow-sm ${palette.cards[index % palette.cards.length]}`}>
            <AnswerShape index={index} className="mt-1 h-6 w-6 shrink-0" />
            <AutoGrowTextarea
              value={choice.text}
              onChange={(event) => onUpdate((value) => ({ ...value, choices: value.choices.map((entry, choiceIndex) => choiceIndex === index ? { ...entry, text: event.target.value } : entry) }))}
              maxLength={200}
              placeholder={`보기 ${index + 1}`}
              className="min-h-12 min-w-0 flex-1 resize-none overflow-hidden bg-transparent text-base font-black leading-snug text-inherit outline-none placeholder:text-current placeholder:opacity-50"
            />
            {question.type === "SINGLE_CHOICE" && (
              <input
                type={question.multipleSelection ? "checkbox" : "radio"}
                name={`correct-${question.clientId}`}
                checked={choice.isCorrect}
                onChange={(event) => setCorrect(index, event.target.checked)}
                className="mt-1 h-6 w-6 shrink-0 cursor-pointer accent-brand-950"
                aria-label={`${index + 1}번 보기를 정답으로 지정`}
              />
            )}
            {question.choices.length > 2 && <button type="button" onClick={() => onUpdate((value) => ({ ...value, choices: value.choices.filter((_, choiceIndex) => choiceIndex !== index) }))} className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg opacity-65 hover:bg-black/10 hover:opacity-100" aria-label={`${index + 1}번 보기 삭제`}><XIcon className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
      </div>
      {question.choices.length < 6 && <button type="button" onClick={() => onUpdate((value) => ({ ...value, choices: [...value.choices, { text: "", isCorrect: false }] }))} className="mt-2 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-brand"><PlusIcon className="h-4 w-4" />보기 추가</button>}
      {question.type === "SINGLE_CHOICE" && <p className="mt-2 text-[11px] font-bold text-content-subtle">단일 정답은 라디오 버튼, 복수 정답은 체크박스로 지정합니다.</p>}
    </div>
  );
}

function QuestionPanel({ question, quiz, selected, doneCount, totalSeconds, totalPoints, onTemplate, onUpdate, onDuplicate, onDelete }: { question: Question; quiz: ReturnType<typeof hydrateQuiz>; selected: number; doneCount: number; totalSeconds: number; totalPoints: number; onTemplate: (type: QuestionType, slideLayout?: SlideLayout) => void; onUpdate: (updater: (question: Question) => Question) => void; onDuplicate: () => void; onDelete: () => void }) {
  return <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-y-auto border-l border-line bg-surface/80 p-5 lg:block"><p className="text-[11px] font-black uppercase tracking-[0.16em] text-brand">항목 {selected + 1} 설정</p><div className="mt-5"><p className="text-xs font-black text-content-muted">템플릿</p><TemplatePicker question={question} onSelect={onTemplate} /></div>{question.type === "SLIDE" ? null : <><div className={`mt-4 grid gap-3 ${isUnscoredType(question.type) ? "grid-cols-1" : "grid-cols-2"}`}><SettingSelect label="제한 시간" value={question.timeLimitSec} values={TIME_STEPS} format={timeLabel} onChange={(value) => onUpdate((entry) => ({ ...entry, timeLimitSec: value }))} />{!isUnscoredType(question.type) && <SettingSelect label="점수 가중치" value={question.points} values={POINT_STEPS} format={pointLabel} onChange={(value) => onUpdate((entry) => ({ ...entry, points: value }))} />}</div><LiveRevealToggle question={question} onUpdate={onUpdate} className="mt-4" /></>}{question.type !== "SLIDE" && <AnswerSummary question={question} onUpdate={onUpdate} />}<div className="mt-6 rounded-2xl bg-surface-muted p-4"><p className="text-xs font-black text-content">퀴즈 요약</p><dl className="mt-3 space-y-2 text-xs"><SummaryRow label="완성된 항목" value={`${doneCount} / ${quiz.questions.length}`} /><SummaryRow label="예상 진행 시간" value={timeLabel(totalSeconds)} /><SummaryRow label="가중치 합계" value={`${totalPoints / 1000}배`} /></dl></div><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={onDuplicate} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-surface-muted text-xs font-black text-content-muted"><CopyIcon className="h-4 w-4" />복제</button><button type="button" onClick={onDelete} className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-danger-soft text-xs font-black text-danger-soft-fg"><TrashIcon className="h-4 w-4" />삭제</button></div></aside>;
}

function SettingSelect({ label, value, values, format, onChange }: { label: string; value: number; values: number[]; format: (value: number) => string; onChange: (value: number) => void }) {
  return <label className="text-xs font-black text-content-muted">{label}<select value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-2 h-11 w-full rounded-xl border border-line bg-surface px-2 text-xs font-bold outline-none focus:border-brand-500">{values.map((option) => <option key={option} value={option}>{format(option)}</option>)}</select></label>;
}

function AnswerSummary({ question, onUpdate }: { question: Question; onUpdate: (updater: (question: Question) => Question) => void }) {
  const choiceQuestion = question.type === "SINGLE_CHOICE" || question.type === "TRUE_FALSE";
  function setCorrect(index: number) {
    onUpdate((value) => ({
      ...value,
      choices: value.choices.map((choice, choiceIndex) => ({
        ...choice,
        isCorrect: value.type === "SINGLE_CHOICE" && value.multipleSelection
          ? choiceIndex === index ? !choice.isCorrect : choice.isCorrect
          : choiceIndex === index,
      })),
    }));
  }
  return <div className="mt-6"><div className="flex items-center gap-2"><p className="text-xs font-black text-content">정답 설정</p>{question.type === "SINGLE_CHOICE" && <span className="rounded-full bg-surface-muted px-2 py-1 text-[10px] font-black text-content-muted">{question.multipleSelection ? "복수" : "단일"}</span>}</div>{choiceQuestion ? <div className="mt-2 space-y-1.5">{question.choices.map((choice, index) => <button key={choice.id ?? index} type="button" onClick={() => setCorrect(index)} className={`flex min-h-10 w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold ${choice.isCorrect ? "bg-brand-soft text-brand-soft-fg" : "bg-surface-muted text-content-muted"}`}><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center border-2 ${question.type === "SINGLE_CHOICE" && !question.multipleSelection || question.type === "TRUE_FALSE" ? "rounded-full" : "rounded-md"} ${choice.isCorrect ? "border-brand bg-brand text-on-brand" : "border-line-strong text-transparent"}`}><CheckIcon className="h-3 w-3" /></span><AnswerShape index={index} className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 whitespace-pre-wrap break-words leading-5">{choice.text || `보기 ${index + 1}`}</span></button>)}</div> : <p className="mt-2 text-xs leading-5 text-content-muted">{ANSWER_SUMMARY_HINTS[question.type] ?? "정답 값에 가까울수록 높은 점수를 받습니다."}</p>}</div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-2"><dt className="text-content-muted">{label}</dt><dd className="font-black text-content">{value}</dd></div>; }

function MobileFilmstrip({ questions, selected, onSelect, onAdd, onInsertAfter, onMove }: { questions: Question[]; selected: number; onSelect: (index: number) => void; onAdd: () => void; onInsertAfter: (index: number) => void; onMove: (from: number, to: number) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  const { dragIndex, indicator, handlePointerDown, suppressClickAfterDrag, setItemRef } = useListDrag({ axis: "x", count: questions.length, listRef, onReorder: onMove });
  return <nav className="fixed inset-x-0 bottom-0 z-30 select-none border-t border-line bg-surface/95 p-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl xl:hidden" aria-label="문제 목록"><ol ref={listRef} className="flex gap-2 overflow-x-auto pb-1">{questions.map((question, index) => <li key={question.clientId} ref={setItemRef(index)} onPointerDown={handlePointerDown(index)} onClickCapture={suppressClickAfterDrag} style={{ touchAction: "pan-x" }} className={`relative shrink-0 ${dragIndex === index ? "z-40" : ""}`}>{indicator === index ? <span className="absolute -left-[5px] inset-y-1 z-10 w-1 rounded-full bg-brand shadow-[0_0_8px_rgba(48,139,221,.8)]" aria-hidden="true" /> : null}{indicator === questions.length && index === questions.length - 1 ? <span className="absolute -right-[5px] inset-y-1 z-10 w-1 rounded-full bg-brand shadow-[0_0_8px_rgba(48,139,221,.8)]" aria-hidden="true" /> : null}<button type="button" onClick={() => onSelect(index)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onInsertAfter(index); } }} title="Enter: 바로 아래에 새 문제 · 길게 눌러 순서 이동" className={`flex h-[74px] w-36 items-start gap-2 rounded-2xl border p-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${dragIndex === index ? "border-brand-500 bg-surface shadow-2xl" : selected === index ? "border-brand-500 bg-brand-soft/40" : "border-line bg-surface"}`}><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[10px] font-black ${selected === index ? "bg-brand text-on-brand" : "bg-surface-muted text-content-muted"}`}>{index + 1}</span><span className="min-w-0"><span className="block text-[9px] font-black text-brand">{templateInfo(question).short}</span><span className="mt-1 line-clamp-2 block text-[11px] font-bold leading-4 text-content-muted">{question.text || question.slideBody || "내용 없음"}</span></span>{completionError(question) && <AlertIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-warning-600 dark:text-warning-400" />}</button></li>)}<li className="shrink-0"><button type="button" onClick={onAdd} className="grid h-[74px] w-16 place-items-center rounded-2xl border border-dashed border-brand-300 dark:border-brand-400/30 bg-brand-soft/40 text-brand" aria-label="콘텐츠 추가"><PlusIcon className="h-5 w-5" /></button></li></ol></nav>;
}

function DialogShell({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <Modal open onClose={onClose} title={title} className={wide ? "modal-lg" : undefined}><div className="bg-surface-sunken p-5 sm:p-6">{children}</div></Modal>;
}

function SettingsDialog({ quizId, quiz, uploadPolicy, doneCount, totalSeconds, totalPoints, onUpdate, onPublish, onDelete, saving, onClose }: { quizId: string; quiz: ReturnType<typeof hydrateQuiz>; uploadPolicy: UploadPolicy; doneCount: number; totalSeconds: number; totalPoints: number; onUpdate: (fields: Partial<typeof quiz>) => void; onPublish: () => void; onDelete: () => void; saving: boolean; onClose: () => void }) {
  return <DialogShell title="퀴즈 설정" onClose={onClose}><div className="space-y-5"><label className="block text-xs font-black text-content-muted">퀴즈 제목<input value={quiz.title} onChange={(event) => onUpdate({ title: event.target.value })} maxLength={120} className="mt-2 h-12 w-full rounded-2xl border border-line bg-surface px-4 text-sm font-black outline-none focus:border-brand-500" /></label><label className="block text-xs font-black text-content-muted">설명<textarea value={quiz.description ?? ""} onChange={(event) => onUpdate({ description: event.target.value })} maxLength={2000} rows={3} className="mt-2 w-full resize-none rounded-2xl border border-line bg-surface p-4 text-sm outline-none focus:border-brand-500" /></label><ThumbnailSetting quizId={quizId} uploadPolicy={uploadPolicy} imageUrl={quiz.thumbnailUrl} imageAlt={quiz.thumbnailAlt} onChange={(thumbnailUrl, thumbnailAlt) => onUpdate({ thumbnailUrl, thumbnailAlt })} /><fieldset><legend className="text-xs font-black text-content-muted">답안 컬러</legend><div className="mt-2 grid grid-cols-3 gap-2">{(Object.keys(PALETTES) as AnswerPalette[]).map((key) => <button key={key} type="button" onClick={() => onUpdate({ answerPalette: key })} className={`rounded-2xl border p-3 text-xs font-black ${quiz.answerPalette === key ? "border-brand-500 bg-brand-soft/40 text-brand-soft-fg ring-1 ring-brand-500" : "border-line bg-surface text-content-muted"}`}><span className="mb-2 flex justify-center -space-x-1">{PALETTES[key].cards.slice(0, 4).map((color, index) => <span key={index} className={`h-4 w-4 rounded-full ring-2 ring-surface ${color.split(" ")[0]}`} />)}</span>{PALETTES[key].label}</button>)}</div></fieldset><label className="flex items-center justify-between gap-4 rounded-2xl bg-surface p-4 ring-1 ring-line"><span><span className="block text-sm font-black text-content">학생 로그인 필요</span><span className="mt-1 block text-xs text-content-muted">끄면 닉네임만으로 참여할 수 있어요.</span></span><input type="checkbox" checked={quiz.requiresLogin} onChange={(event) => onUpdate({ requiresLogin: event.target.checked })} className="h-5 w-5 accent-brand" /></label><label className="flex items-center justify-between gap-4 rounded-2xl bg-surface p-4 ring-1 ring-line"><span><span className="block text-sm font-black text-content">검색 공개</span><span className="mt-1 block text-xs text-content-muted">켜면 다른 선생님이 퀴즈 탐색에서 찾아 열람·복제할 수 있어요.</span></span><input type="checkbox" checked={quiz.isSearchable} onChange={(event) => onUpdate({ isSearchable: event.target.checked })} className="h-5 w-5 accent-brand" /></label><dl className="space-y-2 rounded-2xl bg-surface-muted p-4 text-sm"><SummaryRow label="항목 수" value={`${quiz.questions.length}개`} /><SummaryRow label="완성된 항목" value={`${doneCount} / ${quiz.questions.length}`} /><SummaryRow label="예상 진행 시간" value={timeLabel(totalSeconds)} /><SummaryRow label="가중치 합계" value={`${totalPoints / 1000}배`} /></dl><div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={onPublish} disabled={saving} className="min-h-12 flex-1 rounded-2xl bg-brand-strong px-5 text-sm font-black text-on-brand disabled:opacity-50">{quiz.isPublished ? "변경사항 저장 후 다시 발행" : "저장 후 발행"}</button><button type="button" onClick={onDelete} disabled={saving} className="min-h-12 rounded-2xl bg-danger-soft px-5 text-sm font-black text-danger-soft-fg disabled:opacity-50">퀴즈 삭제</button></div></div></DialogShell>;
}

function ThumbnailSetting({ quizId, uploadPolicy, imageUrl, imageAlt, onChange }: { quizId: string; uploadPolicy: UploadPolicy; imageUrl: string | null; imageAlt: string | null; onChange: (imageUrl: string | null, imageAlt: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function read(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setMessage("이미지 파일만 올릴 수 있습니다.");
    try {
      // 썸네일은 목록에서 퀴즈 개수만큼 한꺼번에 나가므로 서버가 문항 이미지보다 작게 줄입니다.
      onChange(await uploadQuizImage(quizId, file, uploadPolicy, { kind: "thumbnail" }), file.name);
      setMessage(null);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "썸네일을 올리지 못했습니다.");
    }
  }
  return <fieldset><legend className="text-xs font-black text-content-muted">썸네일</legend><div className="mt-2 overflow-hidden rounded-[22px] border border-line bg-surface">{imageUrl ? <div className="relative aspect-[16/7] w-full bg-surface-muted"><Image src={imageUrl} alt={imageAlt || "퀴즈 썸네일"} fill unoptimized sizes="480px" className="object-cover" /><div className="absolute inset-x-3 bottom-3 flex justify-end gap-2"><button type="button" onClick={() => inputRef.current?.click()} className="rounded-xl bg-surface/95 px-3 py-2 text-xs font-black text-content-muted shadow">교체</button><button type="button" onClick={() => { onChange(null, null); setMessage(null); }} className="rounded-xl bg-danger-soft/95 px-3 py-2 text-xs font-black text-danger-soft-fg shadow">삭제</button></div></div> : <button type="button" onClick={() => inputRef.current?.click()} className="flex aspect-[16/6] w-full flex-col items-center justify-center gap-2 bg-surface-muted text-content-muted transition hover:bg-surface-hover hover:text-brand"><ImageIcon className="h-6 w-6" /><span className="text-xs font-black">썸네일 이미지 선택</span><span className="text-[10px] font-bold opacity-70">권장 비율 16:9 · 자동으로 줄여서 저장됩니다</span></button>}<input ref={inputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="sr-only" onChange={(event) => { read(event.target.files?.[0]); event.target.value = ""; }} /></div>{message && <p className="mt-2 text-xs font-bold text-danger">{message}</p>}</fieldset>;
}

function QuestionMenu({ question, onTemplate, onUpdate, onDuplicate, onDelete, onPreview, onClose }: { question: Question; onTemplate: (type: QuestionType, slideLayout?: SlideLayout) => void; onUpdate: (updater: (question: Question) => Question) => void; onDuplicate: () => void; onDelete: () => void; onPreview: () => void; onClose: () => void }) {
  return <DialogShell title="항목 설정" onClose={onClose}><div className="space-y-4"><div><p className="text-xs font-black text-content-muted">템플릿</p><TemplatePicker question={question} onSelect={onTemplate} /></div>{question.type === "SLIDE" ? null : <><div className={`grid gap-3 ${isUnscoredType(question.type) ? "grid-cols-1" : "grid-cols-2"}`}><SettingSelect label="제한 시간" value={question.timeLimitSec} values={TIME_STEPS} format={timeLabel} onChange={(value) => onUpdate((entry) => ({ ...entry, timeLimitSec: value }))} />{!isUnscoredType(question.type) && <SettingSelect label="점수 가중치" value={question.points} values={POINT_STEPS} format={pointLabel} onChange={(value) => onUpdate((entry) => ({ ...entry, points: value }))} />}</div><LiveRevealToggle question={question} onUpdate={onUpdate} /></>}{question.type !== "SLIDE" && <AnswerSummary question={question} onUpdate={onUpdate} />}<div className="grid grid-cols-3 gap-2 pt-2"><button type="button" onClick={onPreview} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-surface-muted text-xs font-black text-content-muted"><PlayIcon className="h-4 w-4" />미리보기</button><button type="button" onClick={onDuplicate} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-surface-muted text-xs font-black text-content-muted"><CopyIcon className="h-4 w-4" />복제</button><button type="button" onClick={onDelete} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl bg-danger-soft text-xs font-black text-danger-soft-fg"><TrashIcon className="h-4 w-4" />삭제</button></div></div></DialogShell>;
}
