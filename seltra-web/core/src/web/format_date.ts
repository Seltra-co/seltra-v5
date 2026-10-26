/** Format a date crossing the web JSON bridge without letting corrupt values crash a page. */
export function formatWebDate(
  value: string | number | Date | null | undefined,
  format: (date: Date) => string,
): string {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isFinite(date.getTime()) ? format(date) : "";
}
