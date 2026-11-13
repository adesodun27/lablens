export type Language = "en" | "pcm" | "yo" | "ha" | "ig";

export const LANGUAGES: { code: Language; label: string; prompt: string }[] = [
  { code: "en", label: "English", prompt: "simple English" },
  { code: "pcm", label: "Pidgin", prompt: "Nigerian Pidgin English" },
  { code: "yo", label: "Yorùbá", prompt: "Yoruba (with correct tone marks)" },
  { code: "ha", label: "Hausa", prompt: "Hausa" },
  { code: "ig", label: "Igbo", prompt: "Igbo" },
];

/** What Gemini reads off the report. Nothing here is a judgement. */
export interface ExtractedTest {
  name: string;
  valueText: string;
  value: number | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  labFlag: string | null;
}

export interface Extraction {
  isLabReport: boolean;
  reportType: string;
  tests: ExtractedTest[];
}

export type Status = "normal" | "low" | "high" | "abnormal" | "unknown";

/** A test after our own code (not the AI) has decided where it sits. */
export interface FlaggedTest extends ExtractedTest {
  id: string;
  status: Status;
  critical: boolean;
  criticalReason: string | null;
  /** 0..1 position of the value across a padded range, for the range bar */
  position: number | null;
}

export interface TestExplanation {
  id: string;
  plainName: string;
  whatItMeasures: string;
  whatYourResultMeans: string;
}

export interface Explanation {
  summary: string;
  urgentMessage: string | null;
  tests: TestExplanation[];
  questionsForDoctor: string[];
}

export interface AnalyzeResponse {
  extraction: Extraction;
  tests: FlaggedTest[];
  explanation: Explanation;
  language: Language;
}
