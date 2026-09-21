"use client";

type ClassOption = { id: string; label: string };

export function AutoSubmitClassSelect({ value, options }: { value: string; options: ClassOption[] }) {
  return (
    <select
      name="classId"
      defaultValue={value}
      aria-label="학급 필터"
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      <option value="">전체 학급</option>
      {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  );
}
