import { Encoder, Profile } from "@garmin/fitsdk";

// Small synthetic FIT files built with the SDK's own Encoder (no real recordings in the repo).

const M = Profile.MesgNum as Record<"FILE_ID" | "RECORD" | "LAP" | "SESSION" | "SET", number>;
// The SDK ships loose typings for messages; the Encoder checks field names itself.
const put = (enc: Encoder, num: number, data: Record<string, unknown>) => enc.onMesg(num, data as never);
const DEG_TO_SEMICIRCLES = 2 ** 31 / 180;
export const START = new Date("2026-10-01T06:00:00Z");

type Opts = { sport: string; subSport?: string; seconds: number; hr?: (i: number) => number; speed?: (i: number) => number; power?: (i: number) => number; gps?: boolean };

function header(enc: Encoder, sport: string) {
  put(enc, M.FILE_ID, { type: "activity", manufacturer: "garmin", product: 1, timeCreated: START, serialNumber: 1 });
  void sport;
}

export function activityFit(o: Opts): Uint8Array {
  const enc = new Encoder();
  header(enc, o.sport);
  let dist = 0;
  for (let i = 0; i < o.seconds; i++) {
    const speed = o.speed?.(i) ?? 0;
    dist += speed;
    put(enc, M.RECORD, {
      timestamp: new Date(START.getTime() + i * 1000),
      heartRate: o.hr?.(i),
      power: o.power?.(i),
      enhancedSpeed: speed,
      distance: dist,
      enhancedAltitude: 100 + i * 0.01,
      ...(o.gps ? { positionLat: Math.round((48 + i * 1e-5) * DEG_TO_SEMICIRCLES), positionLong: Math.round((11 + i * 1e-5) * DEG_TO_SEMICIRCLES) } : {}),
    });
  }
  const half = Math.floor(o.seconds / 2);
  for (const [n, from, to] of [[0, 0, half], [1, half, o.seconds]] as const) {
    put(enc, M.LAP, {
      timestamp: new Date(START.getTime() + to * 1000),
      startTime: new Date(START.getTime() + from * 1000),
      totalElapsedTime: to - from,
      totalTimerTime: to - from,
      totalDistance: dist / 2,
      avgHeartRate: 150 + n,
    });
  }
  put(enc, M.SESSION, {
    timestamp: new Date(START.getTime() + o.seconds * 1000),
    startTime: START,
    totalElapsedTime: o.seconds,
    totalTimerTime: o.seconds,
    sport: o.sport,
    subSport: o.subSport ?? "generic",
    normalizedPower: o.power ? 230 : undefined,
  });
  return enc.close();
}

export const runFit = () => activityFit({ sport: "running", seconds: 600, hr: (i) => 140 + Math.round(i / 30), speed: () => 3, gps: true });
export const rideFit = () => activityFit({ sport: "cycling", seconds: 900, hr: () => 135, speed: () => 8, power: (i) => 200 + (i % 60) });

export function strengthFit(): Uint8Array {
  const enc = new Encoder();
  header(enc, "training");
  const at = (s: number) => new Date(START.getTime() + s * 1000);
  for (let i = 0; i < 600; i++) put(enc, M.RECORD, { timestamp: at(i), heartRate: 100 + (i % 40) });
  const sets = [
    { s: 60, d: 40, type: "active", reps: 10, w: 60, cat: "benchPress" },
    { s: 100, d: 60, type: "rest" },
    { s: 160, d: 40, type: "active", reps: 8, w: 62.5, cat: "benchPress" },
    { s: 200, d: 60, type: "rest" },
    { s: 260, d: 40, type: "active", reps: 12, w: 100, cat: "squat" },
  ];
  sets.forEach((x, i) =>
    put(enc, M.SET, {
      timestamp: at(x.s + x.d),
      startTime: at(x.s),
      duration: x.d,
      setType: x.type,
      messageIndex: i,
      ...(x.type === "active" ? { repetitions: x.reps, weight: x.w, category: [x.cat] } : {}),
    }),
  );
  put(enc, M.SESSION, { timestamp: at(600), startTime: START, totalElapsedTime: 600, totalTimerTime: 600, sport: "training", subSport: "strengthTraining" });
  return enc.close();
}
