import type { EChartsCoreOption } from "echarts/core";
import { m } from "$lib/paraglide/messages.js";
import { customSportColor, dateLabel, duration, KNOWN_SPORTS, num } from "./format.ts";

// ECharts options for the pages. Colours come from the page's CSS variables (canvas cannot resolve var()).
const color = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
// Series names that are not a Garmin-derived sport are the user's own sports.
export const sportCssColor = (sport: string) => (KNOWN_SPORTS.includes(sport) ? color(`--c-${sport}`) : customSportColor(sport));

type Pmc = { date: string; ctl: number; atl: number; tsb: number; tss: number }[];

export function pmcOption(rows: Pmc): EChartsCoreOption {
  const accent = color("--accent");
  return {
    legend: { data: [m.chart_fitness(), m.chart_fatigue(), m.chart_form()] },
    xAxis: { type: "category", data: rows.map((r) => r.date), axisLabel: { formatter: (v: string) => dateLabel(v, { day: "numeric", month: "short" }) } },
    yAxis: { type: "value", splitLine: { lineStyle: { color: color("--border") } } },
    dataZoom: [{ type: "inside" }],
    series: [
      { name: m.chart_fitness(), type: "line", showSymbol: false, data: rows.map((r) => Math.round(r.ctl * 10) / 10), lineStyle: { color: accent, width: 3 }, itemStyle: { color: accent } },
      { name: m.chart_fatigue(), type: "line", showSymbol: false, data: rows.map((r) => Math.round(r.atl * 10) / 10), lineStyle: { color: color("--c-running"), width: 2 }, itemStyle: { color: color("--c-running") } },
      { name: m.chart_form(), type: "bar", data: rows.map((r) => Math.round(r.tsb * 10) / 10), itemStyle: { color: color("--c-other"), opacity: 0.5 } },
    ],
  };
}

type Volume = { period: string; sport: string; duration_s: number; distance_m: number }[];

/** Stacked weekly/monthly bars per sport. `metric`: hours or kilometres. */
export function volumeOption(rows: Volume, metric: "hours" | "km"): EChartsCoreOption {
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const sports = [...new Set(rows.map((r) => r.sport))].sort();
  const value = (r: Volume[number]) => (metric === "hours" ? r.duration_s / 3600 : r.distance_m / 1000);
  return {
    legend: { data: sports.map((s) => sportName(s)) },
    xAxis: { type: "category", data: periods, axisLabel: { formatter: (v: string) => dateLabel(v, { day: "numeric", month: "short" }) } },
    yAxis: { type: "value", name: metric === "hours" ? "h" : "km", splitLine: { lineStyle: { color: color("--border") } } },
    series: sports.map((sport) => ({
      name: sportName(sport),
      type: "bar",
      stack: "volume",
      itemStyle: { color: sportCssColor(sport) },
      data: periods.map((p) => Math.round((rows.filter((r) => r.period === p && r.sport === sport).reduce((a, r) => a + value(r), 0)) * 10) / 10),
    })),
  };
}

export function sportName(sport: string): string {
  const names: Record<string, () => string> = {
    running: m.sport_running, cycling: m.sport_cycling, swimming: m.sport_swimming, strength: m.sport_strength,
    walking: m.sport_walking, hiking: m.sport_hiking, paddling: m.sport_paddling, rowing: m.sport_rowing, other: m.sport_other,
  };
  // Not a Garmin-derived sport: a name the user gave their own sport.
  return names[sport]?.() ?? sport;
}

export type SamplePoint = { t: number; hr: number | null; power: number | null; speed: number | null; alt: number | null; cadence: number | null };

/** Time series of an activity: heart rate always, plus pace (running) or speed, power and altitude where recorded. */
export function seriesOption(samples: SamplePoint[], sport: string): EChartsCoreOption {
  const has = (f: (s: SamplePoint) => number | null) => samples.some((s) => f(s) !== null && f(s)! > 0);
  const series: Record<string, unknown>[] = [];
  const axes: Record<string, unknown>[] = [];
  const add = (name: string, data: (number | null)[], c: string, axis: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const yAxisIndex = axes.length;
    axes.push({ type: "value", position: yAxisIndex % 2 ? "right" : "left", splitLine: { show: yAxisIndex === 0, lineStyle: { color: color("--border") } }, axisLabel: { color: c }, ...axis });
    series.push({ name, type: "line", showSymbol: false, yAxisIndex, data, lineStyle: { color: c, width: 1.5 }, itemStyle: { color: c }, ...extra });
  };
  if (has((s) => s.hr)) add(m.metric_hr(), samples.map((s) => s.hr), color("--c-running"), { name: "bpm", scale: true });
  if (has((s) => s.power)) add(m.metric_power(), samples.map((s) => s.power), color("--c-strength"), { name: "W", min: 0 });
  if (has((s) => s.speed)) {
    if (sport === "running" || sport === "walking" || sport === "hiking") {
      const secPerKm = samples.map((s) => (s.speed && s.speed > 0.5 ? Math.min(1000 / s.speed, 900) : null));
      add(m.metric_pace(), secPerKm, color("--c-cycling"), { inverse: true, axisLabel: { formatter: (v: number) => duration(v), color: color("--c-cycling") }, min: "dataMin", max: "dataMax" });
    } else {
      add(m.metric_speed(), samples.map((s) => (s.speed === null ? null : Math.round(s.speed * 36) / 10)), color("--c-cycling"), { name: "km/h", min: 0 });
    }
  }
  if (has((s) => s.alt)) add(m.metric_altitude(), samples.map((s) => s.alt), color("--c-other"), { name: "m", scale: true }, { areaStyle: { opacity: 0.12 }, lineStyle: { color: color("--c-other"), width: 1 } });
  return {
    legend: { data: series.map((s) => s.name as string) },
    xAxis: { type: "category", data: samples.map((s) => s.t), axisLabel: { formatter: (v: string) => duration(Number(v)) } },
    yAxis: axes,
    dataZoom: [{ type: "inside" }, { type: "slider", height: 18, bottom: 0 }],
    grid: { left: 8, right: axes.length > 1 ? 40 : 12, top: 32, bottom: 36, containLabel: true },
    tooltip: { trigger: "axis", valueFormatter: (v: number) => (v === null || v === undefined ? "–" : num(v, 1)) },
    series,
  };
}

/** Horizontal share of time per zone. `labels` are the zone names. */
export function zoneOption(seconds: number[], labels: string[]): EChartsCoreOption {
  const accent = color("--accent");
  return {
    tooltip: { trigger: "axis", valueFormatter: (v: number) => duration(v) },
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    xAxis: { type: "value", axisLabel: { formatter: (v: number) => duration(v) }, splitLine: { lineStyle: { color: color("--border") } } },
    yAxis: { type: "category", data: labels, inverse: true },
    series: [{ type: "bar", data: seconds.map((s) => Math.round(s)), itemStyle: { color: accent }, label: { show: true, position: "right", formatter: (p: { value: number }) => duration(p.value), color: color("--muted") } }],
  };
}

type Trend = { date: string; restingHr: number | null; restingHr7: number | null; hrv: number | null; hrv7: number | null; sleepHours: number | null; sleep7: number | null; atl: number | null }[];

export function healthOption(points: Trend, metric: "restingHr" | "hrv" | "sleep", label: string): EChartsCoreOption {
  const raw = metric === "restingHr" ? points.map((p) => p.restingHr) : metric === "hrv" ? points.map((p) => p.hrv) : points.map((p) => p.sleepHours);
  const avg = metric === "restingHr" ? points.map((p) => p.restingHr7) : metric === "hrv" ? points.map((p) => p.hrv7) : points.map((p) => p.sleep7);
  const c = color(metric === "restingHr" ? "--c-running" : metric === "hrv" ? "--c-swimming" : "--c-strength");
  const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
  return {
    legend: { data: [label, m.chart_avg7()] },
    xAxis: { type: "category", data: points.map((p) => p.date), axisLabel: { formatter: (v: string) => dateLabel(v, { day: "numeric", month: "short" }) } },
    yAxis: { type: "value", scale: true, splitLine: { lineStyle: { color: color("--border") } } },
    dataZoom: [{ type: "inside" }],
    series: [
      { name: label, type: "line", showSymbol: false, connectNulls: false, data: raw.map(round), lineStyle: { color: c, width: 1, opacity: 0.55 }, itemStyle: { color: c } },
      { name: m.chart_avg7(), type: "line", showSymbol: false, connectNulls: true, data: avg.map(round), lineStyle: { color: c, width: 3 }, itemStyle: { color: c } },
    ],
  };
}

/** Name of the step a sync run is working on (progress banner). */
export function phaseName(phase: string): string {
  const names: Record<string, () => string> = {
    starting: m.phase_starting, zones: m.kind_zones, activities: m.kind_activities, dailies: m.kind_dailies, sleep: m.kind_sleep, hrv: m.kind_hrv, fit: m.kind_fit,
  };
  return (names[phase] ?? m.phase_starting)();
}
