"use client";

import { useState, type ReactNode } from "react";
import styles from "@/components/pad/settings/settings.module.css";

export type PickerOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
};

// 드롭다운 대신 쓰는 시각적 선택지 — "tiles"는 레이아웃·카드 크기·글꼴처럼 짧고 여러 개인 선택지를
// 아이콘+라벨 타일로, "list"는 첨부 다운로드·승인 방식처럼 선택마다 설명이 필요한 경우 세로 목록으로
// 보여줍니다(사용자 피드백 — Padlet처럼 시각 요소 + 아래쪽 작은 설명, 드롭다운 2열 그리드 대신 1행 1설정).
//
// 네이티브 select처럼 controlled(value+onChange)와 uncontrolled(defaultValue만, 부모 <form>의
// FormData로 읽음) 둘 다 지원합니다 — moderationMode처럼 아직 React state로 끌어올리지 않은 필드도
// <input type="radio" name=.../>가 그대로 FormData에 잡히므로 그대로 바꿔 끼울 수 있습니다.
export function OptionPicker<T extends string>({
  name,
  value,
  defaultValue,
  onChange,
  options,
  variant = "list",
}: {
  name: string;
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
  options: PickerOption<T>[];
  variant?: "tiles" | "list";
}) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : internalValue;

  function select(next: T) {
    if (!isControlled) setInternalValue(next);
    onChange?.(next);
  }

  const tiles = variant === "tiles";
  return (
    <div className={tiles ? styles.optionTiles : styles.optionList} role="radiogroup">
      {options.map((option) => {
        const active = option.value === current;
        return (
          <label
            key={option.value}
            className={[
              tiles ? styles.optionTile : styles.optionRow,
              active ? (tiles ? styles.optionTileActive : styles.optionRowActive) : "",
            ].join(" ").trim()}
          >
            <input type="radio" name={name} value={option.value} checked={active} onChange={() => select(option.value)} />
            {option.icon && <span className={tiles ? styles.optionTileIcon : styles.optionRowIcon}>{option.icon}</span>}
            {tiles ? (
              <span>{option.label}</span>
            ) : (
              <span className={styles.optionRowText}>
                <b>{option.label}</b>
                {option.description && <small>{option.description}</small>}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
