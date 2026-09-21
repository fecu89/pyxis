"use client";

import {
  AlignLeft, CalendarDays, Check, CheckSquare, ChevronDown, Circle, Clock, Grid3x3, Heading,
  ListChecks, PenLine, SlidersHorizontal, Star, Type, Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { ContentCardMenu, ContentCardMenuItem, ContentCardMenuSection } from "@/components/ui/content-card-menu";
import { FORM_FIELD_TYPES, type FormFieldType } from "@/lib/forms/field-core";
import styles from "@/components/forms/field-type-picker.module.css";

// 질문 유형 고르기. 유형의 이름·설명·아이콘을 한곳에 모아 두어야 편집기·응답 화면·요약 화면이
// 같은 말을 씁니다.

export const FIELD_TYPE_INFO: Record<FormFieldType, { label: string; hint: string; icon: typeof Type; group: "글" | "선택" | "척도" | "그리드" | "기타" }> = {
  SHORT_TEXT: { label: "단답형", hint: "한 줄로 답합니다", icon: Type, group: "글" },
  LONG_TEXT: { label: "장문형", hint: "여러 줄로 답합니다", icon: AlignLeft, group: "글" },
  MULTIPLE_CHOICE: { label: "객관식 질문", hint: "보기 중 하나만 고릅니다", icon: Circle, group: "선택" },
  CHECKBOXES: { label: "체크박스", hint: "여러 개를 고를 수 있습니다", icon: CheckSquare, group: "선택" },
  DROPDOWN: { label: "드롭다운", hint: "펼쳐서 하나를 고릅니다", icon: ChevronDown, group: "선택" },
  LINEAR_SCALE: { label: "선형 배율", hint: "1~5처럼 눈금에서 고릅니다", icon: SlidersHorizontal, group: "척도" },
  RATING: { label: "등급", hint: "별·하트로 점수를 줍니다", icon: Star, group: "척도" },
  MULTIPLE_CHOICE_GRID: { label: "객관식 그리드", hint: "행마다 하나씩 고릅니다", icon: Grid3x3, group: "그리드" },
  CHECKBOX_GRID: { label: "체크박스 그리드", hint: "행마다 여러 개를 고릅니다", icon: ListChecks, group: "그리드" },
  DATE: { label: "날짜", hint: "달력에서 고릅니다", icon: CalendarDays, group: "기타" },
  TIME: { label: "시간", hint: "시각이나 기간을 입력합니다", icon: Clock, group: "기타" },
  FILE_UPLOAD: { label: "파일 업로드", hint: "로그인한 응답자에게 파일을 받습니다", icon: Upload, group: "기타" },
  SIGNATURE: { label: "서명", hint: "손으로 서명을 받습니다", icon: PenLine, group: "기타" },
  SECTION_HEADER: { label: "설명", hint: "응답을 받지 않는 안내문입니다", icon: Heading, group: "기타" },
};

const GROUP_ORDER = ["글", "선택", "척도", "그리드", "기타"] as const;

type FieldTypePickerProps = {
  value: FormFieldType;
  onChange: (type: FormFieldType) => void;
  disabled?: boolean;
};

export function FieldTypePicker(props: FieldTypePickerProps) {
  return <FieldTypePickerControl key={props.disabled ? "disabled" : "enabled"} {...props} />;
}

function FieldTypePickerControl({ value, onChange, disabled = false }: FieldTypePickerProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const Icon = FIELD_TYPE_INFO[value].icon;
  return (
    <ContentCardMenu
      title="질문 유형"
      open={open && !disabled}
      onOpenChange={setOpen}
      disabled={disabled}
      keyboardNavigation
      triggerRef={trigger}
      triggerClassName={styles.trigger}
      triggerLabel={`질문 유형: ${FIELD_TYPE_INFO[value].label}`}
      panelWidth={300}
      panelMaxHeight={480}
      triggerContent={<><Icon size={16} aria-hidden /><span>{FIELD_TYPE_INFO[value].label}</span><ChevronDown size={15} aria-hidden /></>}
    >
      {GROUP_ORDER.map((group) => (
        <ContentCardMenuSection key={group} label={group}>
          {FORM_FIELD_TYPES.filter((type) => FIELD_TYPE_INFO[type].group === group).map((type) => {
            const TypeIcon = FIELD_TYPE_INFO[type].icon;
            return <ContentCardMenuItem
              key={type}
              icon={<TypeIcon size={16} aria-hidden />}
              description={FIELD_TYPE_INFO[type].hint}
              selected={value === type}
              trailingIcon={value === type ? <Check size={14} aria-hidden /> : undefined}
              onClick={() => {
                setOpen(false);
                onChange(type);
                requestAnimationFrame(() => trigger.current?.focus());
              }}
            >{FIELD_TYPE_INFO[type].label}</ContentCardMenuItem>;
          })}
        </ContentCardMenuSection>
      ))}
    </ContentCardMenu>
  );
}
