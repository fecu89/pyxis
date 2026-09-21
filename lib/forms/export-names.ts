const PATH_SEPARATORS = /[\\/]+/g;
const CONTROL_CHARS = /[\x00-\x1f]/g;

/** XLSX의 응답자 값과 ZIP 최상위 폴더가 반드시 같은 문자열을 쓰게 하는 정본입니다. */
export function responseExportName(label: string, responseId: string) {
  const safeLabel = label
    .normalize("NFC")
    .replace(PATH_SEPARATORS, "_")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, 80) || "익명 응답";
  return `${safeLabel}_${responseId.slice(-6)}`;
}
