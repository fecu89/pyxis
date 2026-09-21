export function requiredCompletion<T extends { required: boolean }>(
  fields: readonly T[],
  isComplete: (field: T) => boolean,
) {
  const required = fields.filter((field) => field.required);
  const completed = required.filter(isComplete).length;
  return {
    completed,
    total: required.length,
    percent: required.length ? Math.min(100, Math.round((completed / required.length) * 100)) : 0,
  };
}
