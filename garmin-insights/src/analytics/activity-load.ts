import { hrTss, normalizedPower, normalizedSpeed, perSecond, powerTss, rTss, stepSeconds, trimp, trimpFromAverage, type HrConfig, type Sample } from "./load.ts";

// Picks the load method for one activity from what is known about the athlete and the activity:
//   cycling + FTP + power  -> power TSS ("power")
//   running + threshold pace -> rTSS ("run_pace")
//   anything with heart rate -> hrTSS ("hr"), with an LTHR/HR-max estimated from the history if none is set ("hr_estimated")
// TRIMP is always computed when heart rate is available, whatever the sport (also for strength training).

export type Thresholds = {
  hrRest?: number | null;
  hrMax?: number | null;
  lthr?: number | null;
  ftp?: number | null;
  thresholdPaceSPerKm?: number | null;
  sex?: "m" | "f" | null;
};
export type ActivityForLoad = {
  sport: string;
  duration_s: number | null;
  avg_hr: number | null;
  avg_power: number | null;
  norm_power: number | null;
  avg_speed: number | null;
};
export type LoadMethod = "power" | "run_pace" | "hr" | "hr_estimated";
export type ActivityLoad = { trimp: number | null; tss: number | null; method: LoadMethod | null };

const DEFAULT_HR_REST = 60;
const LTHR_SHARE_OF_MAX = 0.88; // rule of thumb: lactate threshold HR is 85-90 % of the maximum

export function activityLoad(a: ActivityForLoad, samples: readonly Sample[] | null, th: Thresholds, historicHrMax: number | null): ActivityLoad {
  const duration = samples?.length ? samples.reduce((sum, _s, i) => sum + stepSeconds(samples, i), 0) : (a.duration_s ?? 0);
  const hrMax = th.hrMax ?? historicHrMax;
  const hrCfg: HrConfig | null = hrMax ? { hrRest: th.hrRest ?? DEFAULT_HR_REST, hrMax, sex: th.sex } : null;

  let activityTrimp: number | null = null;
  if (hrCfg) {
    const hasHr = samples?.some((s) => s.hr);
    activityTrimp = hasHr ? trimp(samples!, hrCfg) : a.avg_hr ? trimpFromAverage(duration, a.avg_hr, hrCfg) : null;
  }

  if (a.sport === "cycling" && th.ftp) {
    const power = samples ? perSecond(samples, (s) => s.power) : [];
    const np = power.length ? normalizedPower(power) : (a.norm_power ?? a.avg_power);
    if (np) return { trimp: activityTrimp, tss: powerTss(duration, np, th.ftp), method: "power" };
  }
  if (a.sport === "running" && th.thresholdPaceSPerKm) {
    const speed = samples ? perSecond(samples, (s) => s.speed) : [];
    const normSpeed = speed.length ? normalizedSpeed(speed) : a.avg_speed;
    if (normSpeed) return { trimp: activityTrimp, tss: rTss(duration, normSpeed, 1000 / th.thresholdPaceSPerKm), method: "run_pace" };
  }
  if (activityTrimp !== null && hrCfg) {
    const lthr = th.lthr ?? Math.round(hrCfg.hrMax * LTHR_SHARE_OF_MAX);
    return { trimp: activityTrimp, tss: hrTss(activityTrimp, { ...hrCfg, lthr }), method: th.lthr ? "hr" : "hr_estimated" };
  }
  return { trimp: activityTrimp, tss: null, method: null };
}
