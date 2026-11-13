import type { ExtractedTest, FlaggedTest, Status } from "./types";

/**
 * Deterministic safety layer.
 * The AI only READS the report. Whether a value is low, high or dangerous
 * is decided here, with plain arithmetic, so the model can't talk a
 * dangerous result down (or a normal one up).
 *
 * Critical thresholds are conservative values from commonly published
 * laboratory critical-value lists. They must be reviewed by a clinician
 * before any real-world use.
 */

interface CriticalRule {
  match: RegExp;
  /** unit matcher -> [low, high] (null = no bound) */
  units: { unit: RegExp; low: number | null; high: number | null }[];
  label: string;
}

const CRITICAL_RULES: CriticalRule[] = [
  {
    match: /^(h(a)?emoglobin|hb|hgb)\b/i,
    label: "Haemoglobin",
    units: [
      { unit: /^g\/dl$/i, low: 7, high: 20 },
      { unit: /^g\/l$/i, low: 70, high: 200 },
    ],
  },
  {
    match: /potassium|^k\+?$/i,
    label: "Potassium",
    units: [{ unit: /^(mmol\/l|meq\/l)$/i, low: 2.8, high: 6.2 }],
  },
  {
    match: /sodium|^na\+?$/i,
    label: "Sodium",
    units: [{ unit: /^(mmol\/l|meq\/l)$/i, low: 120, high: 160 }],
  },
  {
    match: /glucose|blood sugar|\bfbs\b|\brbs\b/i,
    label: "Blood sugar",
    units: [
      { unit: /^mg\/dl$/i, low: 54, high: 400 },
      { unit: /^mmol\/l$/i, low: 3.0, high: 22.2 },
    ],
  },
  {
    match: /platelet|\bplt\b/i,
    label: "Platelets",
    units: [
      {
        unit: /^(x?\s?10\^?9\/l|x?\s?10\^?3\/(µ|u|m)l|10\*9\/l|10\*3\/(µ|u)l|k\/(µ|u)l)$/i,
        low: 20,
        high: 1000,
      },
    ],
  },
  {
    match: /white (blood )?cell|\bwbc\b|leu[ck]ocyte/i,
    label: "White blood cells",
    units: [
      {
        unit: /^(x?\s?10\^?9\/l|x?\s?10\^?3\/(µ|u|m)l|10\*9\/l|10\*3\/(µ|u)l|k\/(µ|u)l)$/i,
        low: 2,
        high: 30,
      },
    ],
  },
  {
    match: /creatinine/i,
    label: "Creatinine",
    units: [
      { unit: /^mg\/dl$/i, low: null, high: 5 },
      { unit: /^(µ|u)mol\/l$/i, low: null, high: 440 },
    ],
  },
  {
    match: /^calcium|^ca\b/i,
    label: "Calcium",
    units: [
      { unit: /^mg\/dl$/i, low: 6, high: 13 },
      { unit: /^mmol\/l$/i, low: 1.5, high: 3.25 },
    ],
  },
];

const NEGATIVE_WORDS = /\b(negative|non[- ]?reactive|not seen|absent|nil|none seen|no growth|not detected)\b/i;
const POSITIVE_WORDS = /\b(positive|reactive|seen|present|detected)\b|\+/i;

function normUnit(u: string | null): string {
  return (u ?? "")
    .replace(/\s+/g, "")
    .replace(/×/g, "x")
    .replace(/μ/g, "µ")
    .replace(/³/g, "^3")
    .replace(/⁹/g, "^9")
    .toLowerCase();
}

function checkCritical(t: ExtractedTest): string | null {
  if (t.value === null) return null;
  for (const rule of CRITICAL_RULES) {
    if (!rule.match.test(t.name.trim())) continue;
    const unit = normUnit(t.unit);
    for (const u of rule.units) {
      if (!u.unit.test(unit)) continue;
      if (u.low !== null && t.value < u.low)
        return `${rule.label} is dangerously low (${t.value} ${t.unit}).`;
      if (u.high !== null && t.value > u.high)
        return `${rule.label} is dangerously high (${t.value} ${t.unit}).`;
    }
  }
  return null;
}

function statusFor(t: ExtractedTest): Status {
  if (t.value !== null && (t.refLow !== null || t.refHigh !== null)) {
    if (t.refLow !== null && t.value < t.refLow) return "low";
    if (t.refHigh !== null && t.value > t.refHigh) return "high";
    return "normal";
  }

  // Qualitative results (malaria parasite, HBsAg, urine protein, etc.)
  const v = t.valueText ?? "";
  const ref = t.refText ?? "";
  if (t.value === null && v) {
    const valueNeg = NEGATIVE_WORDS.test(v);
    const valuePos = !valueNeg && POSITIVE_WORDS.test(v);
    const refNeg = NEGATIVE_WORDS.test(ref);
    if (valueNeg) return "normal";
    if (valuePos && (refNeg || !ref)) return "abnormal";
  }

  // Fall back to the H / L flag printed by the lab itself
  const f = (t.labFlag ?? "").trim().toUpperCase();
  if (f.startsWith("H") || f === "↑") return "high";
  if (f.startsWith("L") || f === "↓") return "low";
  if (f === "N") return "normal";
  return "unknown";
}

function positionFor(t: ExtractedTest): number | null {
  if (t.value === null || t.refLow === null || t.refHigh === null) return null;
  const span = t.refHigh - t.refLow;
  if (span <= 0) return null;
  // Bar shows the normal band in the middle 50%, with 25% padding either side
  const min = t.refLow - span * 0.5;
  const max = t.refHigh + span * 0.5;
  return Math.min(1, Math.max(0, (t.value - min) / (max - min)));
}

export function flagTests(tests: ExtractedTest[]): FlaggedTest[] {
  return tests.map((t, i) => {
    const criticalReason = checkCritical(t);
    return {
      ...t,
      id: `t${i}`,
      status: statusFor(t),
      critical: criticalReason !== null,
      criticalReason,
      position: positionFor(t),
    };
  });
}

const ORDER: Record<Status, number> = { abnormal: 1, high: 1, low: 1, unknown: 2, normal: 3 };

export function sortTests(tests: FlaggedTest[]): FlaggedTest[] {
  return [...tests].sort((a, b) => {
    if (a.critical !== b.critical) return a.critical ? -1 : 1;
    return ORDER[a.status] - ORDER[b.status];
  });
}
