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

/**
 * Multisport: shades each leg's time span in a time-series option from seriesOption (markArea on the first series, usually
 * the heart rate). The x axis is a category axis of sample times, so the spans are given as indices of the nearest samples.
 */
export function withLegAreas(option: EChartsCoreOption, samples: SamplePoint[], legs: { start_offset_s: number; duration_s: number | null; sport: string; label: string }[]): EChartsCoreOption {
  const series = (option.series as Record<string, unknown>[] | undefined) ?? [];
  if (!legs.length || !series.length || !samples.length) return option;
  const indexAt = (t: number) => {
    const i = samples.findIndex((s) => s.t >= t);
    return i < 0 ? samples.length - 1 : i;
  };
  const areas = legs.map((l) => [
    { xAxis: indexAt(l.start_offset_s), name: l.label, itemStyle: { color: sportCssColor(l.sport), opacity: 0.12 } },
    { xAxis: l.duration_s === null ? samples.length - 1 : indexAt(l.start_offset_s + l.duration_s) },
  ]);
  const [first, ...rest] = series;
  return { ...option, series: [{ ...first, markArea: { silent: true, label: { color: color("--muted"), fontSize: 11 }, data: areas } }, ...rest] };
}

export type WeekRow = { week: string; acwr: number | null; sport_mix: { sport: string; duration_s: number }[] };

// The ACWR range that counts as the sweet spot, drawn as two guide lines (same numbers as ACWR_SWEET_SPOT in the backend).
const ACWR_SWEET_SPOT = [0.8, 1.3] as const;

/** Weekly stacked bars of training time per sport (hours) with the ACWR as a line on a second axis. */
export function weeklyBalanceOption(rows: WeekRow[]): EChartsCoreOption {
  const sports = [...new Set(rows.flatMap((r) => r.sport_mix.map((s) => s.sport)))].sort();
  const hours = (r: WeekRow, sport: string) => Math.round((r.sport_mix.find((s) => s.sport === sport)?.duration_s ?? 0) / 360) / 10;
  const accent = color("--accent");
  const guide = { symbol: "none", silent: true, label: { show: false }, lineStyle: { color: color("--muted"), type: "dashed" } };
  return {
    legend: { data: [...sports.map((s) => sportName(s)), m.weekly_acwr()] },
    xAxis: { type: "category", data: rows.map((r) => r.week), axisLabel: { formatter: (v: string) => dateLabel(v, { day: "numeric", month: "short" }) } },
    yAxis: [
      { type: "value", name: "h", splitLine: { lineStyle: { color: color("--border") } } },
      { type: "value", name: m.weekly_acwr(), min: 0, splitLine: { show: false } },
    ],
    series: [
      ...sports.map((sport) => ({ name: sportName(sport), type: "bar", stack: "time", itemStyle: { color: sportCssColor(sport) }, data: rows.map((r) => hours(r, sport)) })),
      {
        name: m.weekly_acwr(), type: "line", yAxisIndex: 1, connectNulls: false, data: rows.map((r) => r.acwr), lineStyle: { color: accent, width: 3 }, itemStyle: { color: accent },
        markLine: { ...guide, data: ACWR_SWEET_SPOT.map((yAxis) => ({ yAxis })) },
      },
    ],
  };
}

export type PaddlingWeek = { week: string; group: string; distance_m: number; avg_speed_kmh: number | null; avg_efficiency: number | null };

const ROUND_EFFICIENCY = 1000;

/** Weekly paddling: distance as bars (stacked per own sport), average speed and efficiency as lines on their own axes. */
export function paddlingOption(rows: PaddlingWeek[]): EChartsCoreOption {
  const weeks = [...new Set(rows.map((r) => r.week))].sort();
  const groups = [...new Set(rows.map((r) => r.group))].sort();
  const cell = (week: string, group: string) => rows.find((r) => r.week === week && r.group === group);
  const grid = { lineStyle: { color: color("--border") } };
  const lineOf = (name: string, yAxisIndex: number, line: "solid" | "dashed", pick: (r: PaddlingWeek) => number | null) =>
    groups.map((group) => ({
      name: `${name} · ${sportName(group)}`,
      type: "line",
      yAxisIndex,
      connectNulls: true,
      lineStyle: { color: sportCssColor(group), type: line, width: 2 },
      itemStyle: { color: sportCssColor(group) },
      data: weeks.map((w) => {
        const r = cell(w, group);
        return r ? pick(r) : null;
      }),
    }));
  const round = (v: number | null, f: number) => (v === null ? null : Math.round(v * f) / f);
  return {
    legend: { data: [m.paddling_distance(), ...groups.map((g) => `${m.paddling_speed()} · ${sportName(g)}`), ...groups.map((g) => `${m.paddling_efficiency()} · ${sportName(g)}`)], type: "scroll" },
    xAxis: { type: "category", data: weeks, axisLabel: { formatter: (v: string) => dateLabel(v, { day: "numeric", month: "short" }) } },
    yAxis: [
      { type: "value", name: m.paddling_unit_km(), splitLine: grid },
      { type: "value", name: m.paddling_unit_kmh(), splitLine: { show: false } },
      { type: "value", show: false, scale: true },
    ],
    series: [
      ...groups.map((group) => ({
        name: groups.length === 1 ? m.paddling_distance() : `${m.paddling_distance()} · ${sportName(group)}`,
        type: "bar",
        stack: "distance",
        itemStyle: { color: sportCssColor(group), opacity: 0.45 },
        data: weeks.map((w) => round((cell(w, group)?.distance_m ?? 0) / 1000, 10)),
      })),
      ...lineOf(m.paddling_speed(), 1, "solid", (r) => round(r.avg_speed_kmh, 10)),
      ...lineOf(m.paddling_efficiency(), 2, "dashed", (r) => round(r.avg_efficiency, ROUND_EFFICIENCY)),
    ],
  };
}
