// 시간대를 명시하지 않으면 실행 환경의 시간대를 따라가서, 서버(SSR)와 브라우저의 시간대가
// 다를 때 같은 시각이 다른 날짜로 그려져 하이드레이션 불일치가 납니다. 한국 학교용 서비스라
// 항상 한국 시간으로 고정합니다.
const TIME_ZONE = "Asia/Seoul";
const defaultDateFormatter = new Intl.DateTimeFormat("ko-KR", { timeZone: TIME_ZONE, year: "numeric", month: "short", day: "numeric" });
const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", { timeZone: TIME_ZONE, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const numberFormatter = new Intl.NumberFormat("ko-KR");

export function formatDate(value: Date | string, options?: Intl.DateTimeFormatOptions) {
  const formatter = options
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: TIME_ZONE, ...options })
    : defaultDateFormatter;
  return formatter.format(new Date(value));
}

export function formatDateTime(value: Date | string) {
  return dateTimeFormatter.format(new Date(value));
}

export function formatNumber(value: number) {
  return numberFormatter.format(value);
}
