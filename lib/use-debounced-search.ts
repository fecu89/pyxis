"use client";

import { useEffect } from "react";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";

type DebouncedSearchOptions = {
  value: string;
  committedValue: string;
  onSearch: (value: string) => void;
  delay?: number;
  minimumLength?: number;
};

export function normalizeSearchValue(value: string, minimumLength = 1) {
  const trimmed = value.trim();
  return trimmed.length >= minimumLength ? trimmed : "";
}

/** 입력이 잠시 멈춘 뒤 검색을 반영합니다. 최소 길이 미만은 검색하지 않고 전체 목록으로 돌아갑니다. */
export function useDebouncedSearch({
  value,
  committedValue,
  onSearch,
  delay = 350,
  minimumLength = 1,
}: DebouncedSearchOptions) {
  const { schedule, cancel } = useDebouncedCallback(onSearch, delay);

  useEffect(() => {
    const nextValue = normalizeSearchValue(value, minimumLength);
    if (nextValue === committedValue.trim()) return;

    schedule(nextValue);
    return cancel;
  }, [committedValue, minimumLength, value, schedule, cancel]);
}
