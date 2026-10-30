/** Every n-th row, always including the first and the last: enough for a chart, a map line or a compact tool answer. */
export function downsample<T>(rows: readonly T[], max: number): T[] {
  if (rows.length <= max) return [...rows];
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]!);
}
