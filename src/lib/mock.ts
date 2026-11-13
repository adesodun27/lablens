import type { Explanation, Extraction, FlaggedTest } from "./types";

/** Used when GEMINI_MOCK=1 — lets you demo/design the UI with no API calls. */
export const MOCK_EXTRACTION: Extraction = {
  isLabReport: true,
  reportType: "Full Blood Count, Malaria Parasite & Chemistry",
  tests: [
    { name: "Haemoglobin (Hb)", valueText: "6.4", value: 6.4, unit: "g/dL", refLow: 12, refHigh: 16, refText: "12.0 - 16.0", labFlag: "L" },
    { name: "Packed Cell Volume", valueText: "19", value: 19, unit: "%", refLow: 36, refHigh: 46, refText: "36 - 46", labFlag: "L" },
    { name: "White Blood Cells (WBC)", valueText: "11.8", value: 11.8, unit: "x10^9/L", refLow: 4, refHigh: 11, refText: "4.0 - 11.0", labFlag: "H" },
    { name: "Neutrophils", valueText: "72", value: 72, unit: "%", refLow: 40, refHigh: 75, refText: "40 - 75", labFlag: null },
    { name: "Platelets", valueText: "142", value: 142, unit: "x10^9/L", refLow: 150, refHigh: 400, refText: "150 - 400", labFlag: "L" },
    { name: "Malaria Parasite (MP)", valueText: "Seen ++", value: null, unit: null, refLow: null, refHigh: null, refText: "Not seen", labFlag: null },
    { name: "Fasting Blood Sugar", valueText: "5.1", value: 5.1, unit: "mmol/L", refLow: 3.9, refHigh: 5.6, refText: "3.9 - 5.6", labFlag: null },
  ],
};

export function mockExplanation(tests: FlaggedTest[]): Explanation {
  return {
    summary:
      "Your blood is carrying far less oxygen than it should, and the test found malaria parasites. Together these need a doctor's attention today. Your blood sugar is in the normal range.",
    urgentMessage: "Abeg go hospital today, carry this result go show doctor.",
    tests: tests.map((t) => ({
      id: t.id,
      plainName: t.name.replace(/\s*\(.*\)/, ""),
      whatItMeasures: "Mock explanation of what this test measures.",
      whatYourResultMeans: `Your result (${t.valueText}) is marked “${t.status}”. In real mode Gemini explains this in plain words.`,
    })),
    questionsForDoctor: [
      "How serious is my low haemoglobin, and do I need a transfusion?",
      "Which malaria treatment is right for me?",
      "Should I repeat my blood count after treatment, and when?",
    ],
  };
}
