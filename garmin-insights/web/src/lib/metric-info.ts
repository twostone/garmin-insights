import { m } from "$lib/paraglide/messages.js";

// Explanations of the metrics shown in the app (InfoTip). One place, so every page explains a metric the same way.
export type Metric = "ctl" | "atl" | "tsb" | "tss" | "trimp" | "acwr" | "monotony" | "strain" | "decoupling" | "np" | "te" | "vo2max" | "e1rm" | "hrv" | "resting_hr" | "sleep" | "body_battery";

export const METRIC_INFO: Record<Metric, { title: () => string; text: () => string }> = {
  ctl: { title: m.info_ctl_title, text: m.info_ctl_text },
  atl: { title: m.info_atl_title, text: m.info_atl_text },
  tsb: { title: m.info_tsb_title, text: m.info_tsb_text },
  tss: { title: m.info_tss_title, text: m.info_tss_text },
  trimp: { title: m.info_trimp_title, text: m.info_trimp_text },
  acwr: { title: m.info_acwr_title, text: m.info_acwr_text },
  monotony: { title: m.info_monotony_title, text: m.info_monotony_text },
  strain: { title: m.info_strain_title, text: m.info_strain_text },
  decoupling: { title: m.info_decoupling_title, text: m.info_decoupling_text },
  np: { title: m.info_np_title, text: m.info_np_text },
  te: { title: m.info_te_title, text: m.info_te_text },
  vo2max: { title: m.info_vo2max_title, text: m.info_vo2max_text },
  e1rm: { title: m.info_e1rm_title, text: m.info_e1rm_text },
  hrv: { title: m.info_hrv_title, text: m.info_hrv_text },
  resting_hr: { title: m.info_resting_hr_title, text: m.info_resting_hr_text },
  sleep: { title: m.info_sleep_title, text: m.info_sleep_text },
  body_battery: { title: m.info_body_battery_title, text: m.info_body_battery_text },
};
