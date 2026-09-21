export function normalizeSubjectName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}

export function cleanSubjectName(value: string | null | undefined) {
  const name = value?.trim().replace(/\s+/g, " ") ?? "";
  return name.slice(0, 60);
}
