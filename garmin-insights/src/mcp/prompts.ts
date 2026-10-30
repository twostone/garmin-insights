import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { addDays, isDate, todayLocal, weekStart } from "../dates.ts";

// Prompts that tell the model which tools to call and what to deliver. They contain no user data themselves.

const text = (value: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: value } }] });
const date = z.string().refine(isDate, "date as YYYY-MM-DD");

export function registerPrompts(server: McpServer, today: () => string = todayLocal): void {
  server.registerPrompt(
    "analyze_week",
    {
      title: "Analyze a training week",
      description: "Reviews one training week (Monday to Sunday): load, balance, intensity, recovery, and what to do next.",
      argsSchema: z.object({ week_start: date.optional().describe("Monday of the week, YYYY-MM-DD (default: the last full week)") }),
    },
    ({ week_start }) => {
      const start = week_start ? weekStart(week_start) : addDays(weekStart(today()), -7);
      const end = addDays(start, 6);
      return text(
        [
          `Analyze my training week ${start} to ${end} using only data from the Garmin Insights tools. If something is missing, say so instead of guessing.`,
          "",
          `1. get_training_load for ${addDays(start, -42)} to ${end}: how did fitness (CTL), fatigue (ATL) and form (TSB) change over the week, and how does the week's load compare with the previous 4 weeks?`,
          `2. list_activities from ${start} to ${end}, then get_activity for the key sessions: what was the purpose of each, and how well did it go (pace/power against heart rate, aerobic decoupling, laps)?`,
          `3. get_zone_distribution (kind hr) for the week: is the intensity distribution sensible (mostly easy, few hard sessions)?`,
          `4. get_volume (by week, last 8 weeks) and get_strength_sets for the week: is the mix of running, cycling and strength balanced?`,
          `5. get_health_trends for the last 28 days: resting heart rate, HRV and sleep against the baseline. Any sign of accumulated fatigue?`,
          "",
          "Finish with a short summary: what went well, what to watch, and three concrete recommendations for next week.",
        ].join("\n"),
      );
    },
  );

  server.registerPrompt(
    "race_readiness",
    {
      title: "Race readiness check",
      description: "Judges whether the athlete is ready for a race and how to taper.",
      argsSchema: z.object({
        race_date: date.describe("Race day, YYYY-MM-DD"),
        sport: z.enum(["running", "cycling"]).default("running"),
        distance_km: z.string().optional().describe("Race distance in km, for example 21.1"),
        goal: z.string().optional().describe("Goal, for example 'sub 1:45' or 'finish comfortably'"),
      }),
    },
    ({ race_date, sport, distance_km, goal }) => {
      const t = today();
      return text(
        [
          `Assess my readiness for a ${sport === "cycling" ? "cycling" : "running"} race${distance_km ? ` over ${distance_km} km` : ""} on ${race_date}${goal ? ` (goal: ${goal})` : ""}. Today is ${t}. Use only data from the Garmin Insights tools; say where data is missing.`,
          "",
          `1. get_training_load for the last 12 weeks (weekly): is fitness (CTL) still building, at its peak or declining? Does the trend lead to a form (TSB) of roughly +5 to +25 on race day if I taper?`,
          `2. get_volume (by week, last 12 weeks, sport ${sport}) and list_activities (sport ${sport}): weekly volume, the longest sessions, consistency, and whether there were gaps or sudden jumps.`,
          `3. get_best_efforts (sport ${sport}, last 12 months): what do my recent best efforts and ${sport === "cycling" ? "power curve" : "pace"} imply for the goal? Use get_athlete_settings for my thresholds.`,
          `4. get_health_trends for the last 28 days: resting heart rate, HRV and sleep against the baseline.`,
          "",
          `Deliver: a readiness verdict (ready / on track / at risk) with the reasons, a day-by-day taper outline from now to ${race_date}, and pacing or power guidance for race day based on the data.`,
        ].join("\n"),
      );
    },
  );
}
