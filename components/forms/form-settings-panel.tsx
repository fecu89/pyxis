"use client";

import { Modal } from "@/components/ui/modal";
import { ToggleRow } from "@/components/forms/field-settings";
import { SubjectCombobox } from "@/components/quiz/subject-combobox";

// 설문 전체 설정. 질문 카드에 섞지 않고 옆 패널로 뺀 이유 — 이 값들은 한 번 정하고 잘 바꾸지
// 않는데, 본문에 두면 질문을 쓰는 동안 계속 눈에 걸립니다(구글 설문지도 톱니바퀴 뒤에 둡니다).
//
// 열림·닫힘·포커스 트랩·Escape·바깥 클릭은 손으로 만들지 않고 components/ui/modal.tsx의
// `variant="side"`를 그대로 씁니다. 패드 보드의 설정 패널(components/pad/pad-canvas.tsx)이
// 이미 같은 조합을 쓰고 있고, 처음 이 패널을 만들 때 그 로직을 다시 만들었던 것이
// 실수였습니다 — 포커스 복원 같은 미묘한 동작이 한 곳에서만 옳고 나머지에서 어긋나기 쉽습니다.

export type FormSettings = {
  title: string;
  description: string;
  subjectName: string;
  requiresLogin: boolean;
  allowMultipleResponses: boolean;
  allowEditAfterSubmit: boolean;
  shuffleFields: boolean;
  showProgressBar: boolean;
  confirmationMessage: string;
  closedMessage: string;
  dailyResponseDigestEnabled: boolean;
  /** `datetime-local`이 읽는 로컬 시각 문자열입니다. 비어 있으면 제한 없음. */
  openAt: string;
  closeAt: string;
  maxResponses: number | null;
};

export function FormSettingsPanel({ open, value, subjects, loginRequiredByFileUpload = false, onChange, onClose }: {
  open: boolean;
  value: FormSettings;
  subjects: { id: string; name: string }[];
  loginRequiredByFileUpload?: boolean;
  onChange: (patch: Partial<FormSettings>) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="설문 설정"
      description="응답자, 표시, 기간처럼 설문 전체에 적용되는 값입니다."
      variant="side"
    >
      <div className="space-y-6 overflow-y-auto px-4 py-5">
        <Group title="응답자">
          <ToggleRow
            label="로그인 필요"
            hint={value.requiresLogin
              ? loginRequiredByFileUpload
                ? "파일 업로드 질문이 있어 로그인이 필요합니다."
                : "학교 계정으로 로그인한 사람만 응답합니다. 누가 냈는지 남습니다."
              : "링크를 가진 누구나 응답합니다. 응답자는 익명이고 브라우저 쿠키로만 구분됩니다."}
            checked={value.requiresLogin}
            disabled={loginRequiredByFileUpload && value.requiresLogin}
            onChange={(requiresLogin) => onChange({ requiresLogin })}
          />
          <ToggleRow
            label="한 사람이 여러 번 응답"
            hint="끄면 1인 1회만 받습니다."
            checked={value.allowMultipleResponses}
            onChange={(allowMultipleResponses) => onChange({ allowMultipleResponses })}
          />
          <ToggleRow
            label="제출 후 수정 허용"
            checked={value.allowEditAfterSubmit}
            onChange={(allowEditAfterSubmit) => onChange({ allowEditAfterSubmit })}
          />
        </Group>

        <Group title="알림">
          <ToggleRow
            label="새 응답 일일 요약"
            hint="새 응답을 모아 하루에 한 번 설문 소유자에게 알립니다."
            checked={value.dailyResponseDigestEnabled}
            onChange={(dailyResponseDigestEnabled) => onChange({ dailyResponseDigestEnabled })}
          />
        </Group>

        <Group title="표시">
          <ToggleRow label="질문 순서 섞기" checked={value.shuffleFields} onChange={(shuffleFields) => onChange({ shuffleFields })} />
          <ToggleRow label="진행률 표시" checked={value.showProgressBar} onChange={(showProgressBar) => onChange({ showProgressBar })} />
          <Field label="제출 완료 문구">
            <textarea
              value={value.confirmationMessage}
              onChange={(event) => onChange({ confirmationMessage: event.target.value })}
              maxLength={1000}
              rows={3}
              placeholder="응답해 주셔서 감사합니다."
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand"
            />
          </Field>
          <Field label="응답 마감 안내">
            <textarea
              value={value.closedMessage}
              onChange={(event) => onChange({ closedMessage: event.target.value })}
              maxLength={1000}
              rows={3}
              placeholder="이 설문은 응답이 마감되었습니다."
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand"
            />
            <span className="block text-[11px] font-bold text-content-subtle">직접 마감하거나 기간·정원이 끝난 뒤 응답 링크에 표시됩니다.</span>
          </Field>
        </Group>

        <Group title="기간과 정원">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(68px,.62fr)] gap-2">
            <Field label="응답 시작">
              <input
                type="datetime-local"
                value={value.openAt}
                onChange={(event) => onChange({ openAt: event.target.value })}
                className="min-h-10 w-full min-w-0 rounded-xl border border-line bg-surface px-2 text-xs outline-none transition focus:border-brand"
              />
            </Field>
            <Field label="응답 마감">
              <input
                type="datetime-local"
                value={value.closeAt}
                onChange={(event) => onChange({ closeAt: event.target.value })}
                className="min-h-10 w-full min-w-0 rounded-xl border border-line bg-surface px-2 text-xs outline-none transition focus:border-brand"
              />
            </Field>
            <Field label="정원">
              <input
                type="number"
                min={1}
                max={100000}
                value={value.maxResponses ?? ""}
                onChange={(event) => onChange({ maxResponses: event.target.value ? Number(event.target.value) : null })}
                placeholder="∞"
                aria-label="응답 정원, 비우면 제한 없음"
                className="min-h-10 w-full min-w-0 rounded-xl border border-line bg-surface px-2 text-xs outline-none transition focus:border-brand"
              />
            </Field>
          </div>
        </Group>

        <Group title="분류">
          <Field label="교과목">
            <SubjectCombobox
              value={value.subjectName}
              onChange={(subjectName) => onChange({ subjectName })}
              subjects={subjects}
              minQueryLength={2}
              menuPlacement="top"
              placeholder="교과목 이름을 2자 이상 입력"
              inputClassName="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none transition focus:border-brand"
            />
            <span className="block text-[11px] font-bold text-content-subtle">2자 이상 입력하면 기존 교과목을 선택할 수 있습니다.</span>
          </Field>
        </Group>
      </div>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-black uppercase tracking-wide text-content-subtle">{title}</h3>
      <div className="space-y-3 rounded-2xl border border-line bg-surface-inset p-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-black text-content-muted">{label}</span>
      {children}
    </label>
  );
}
