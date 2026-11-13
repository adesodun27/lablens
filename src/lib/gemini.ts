import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Explanation, Extraction, FlaggedTest, Language } from "./types";
import { LANGUAGES } from "./types";

const MODELS = [
  process.env.GEMINI_MODEL,
  "gemini-3.8-flash",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenAI({ apiKey });
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Model doesn't exist for this key -> skip straight to the next model
const MISSING = /not found|404|is not supported|no longer available/i;
// Busy / transient -> retry once, then fall back to the next model
const BUSY = /503|500|UNAVAILABLE|overloaded|high demand|INTERNAL|deadline|timed? ?out|abort/i;

/**
 * Every request gets a hard time budget so we always answer the browser
 * with clean JSON before Vercel kills the function.
 */
export class Budget {
  private end: number;
  constructor(ms: number) {
    this.end = Date.now() + ms;
  }
  left() {
    return this.end - Date.now();
  }
}

export class BusyError extends Error {
  constructor() {
    super("AI busy (503)");
  }
}

async function generateJson<T>(
  parts: Part[],
  schema: object,
  system: string,
  budget: Budget,
): Promise<T> {
  const ai = client();
  let lastErr: unknown;
  for (const model of MODELS) {
    let useThinking = true;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Need at least ~8s to make a call worth trying
      if (budget.left() < 8000) throw new BusyError();
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            temperature: 0.2,
            // Low thinking = much faster; this is reading + plain explaining
            ...(useThinking ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
            abortSignal: AbortSignal.timeout(Math.min(budget.left() - 2000, 45000)),
          },
        });
        const text = res.text;
        if (!text) throw new Error("Empty response from model (503)");
        return JSON.parse(text) as T;
      } catch (err) {
        lastErr = err;
        const msg = String((err as Error)?.message ?? err);
        if (MISSING.test(msg)) break; // next model
        if (useThinking && /thinking/i.test(msg)) {
          useThinking = false; // model doesn't support thinkingLevel; retry without
          attempt--;
          continue;
        }
        if (err instanceof SyntaxError || BUSY.test(msg)) {
          if (attempt === 0) await sleep(1000);
          continue; // retry once, then next model
        }
        throw err; // bad key, bad request, etc.
      }
    }
  }
  if (lastErr && BUSY.test(String((lastErr as Error)?.message ?? lastErr))) throw new BusyError();
  throw lastErr;
}

/* ---------------- Step 1: read the report ---------------- */

const EXTRACT_SYSTEM = `You read photos or PDFs of medical laboratory reports and copy the results into JSON.
Rules:
- Copy ONLY what is printed. Never guess, infer or invent a value, unit or reference range.
- If a reference range is not printed for a test, set refLow, refHigh and refText to null.
- For "<5" style ranges set refLow null, refHigh 5. For ">60" set refLow 60, refHigh null.
- value is the numeric result only; for text results (e.g. "Negative", "Seen ++") set value null and put the text in valueText.
- labFlag is the H / L / * marker printed next to the result, or null.
- NEVER include the patient's name, age, phone, address, hospital number or any other personal identifier anywhere.
- If the image is not a lab report, set isLabReport false and return an empty tests array.`;

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    isLabReport: { type: "boolean" },
    reportType: { type: "string", description: "e.g. Full Blood Count, Lipid Profile, Malaria Test" },
    tests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          valueText: { type: "string" },
          value: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          refLow: { type: ["number", "null"] },
          refHigh: { type: ["number", "null"] },
          refText: { type: ["string", "null"] },
          labFlag: { type: ["string", "null"] },
        },
        required: ["name", "valueText", "value", "unit", "refLow", "refHigh", "refText", "labFlag"],
      },
    },
  },
  required: ["isLabReport", "reportType", "tests"],
};

export async function extractReport(
  files: { mimeType: string; data: string }[],
  budget: Budget,
): Promise<Extraction> {
  const parts: Part[] = [
    ...files.map((f) => ({ inlineData: f })),
    { text: "Extract every test result from this lab report." },
  ];
  const out = await generateJson<Extraction>(parts, EXTRACT_SCHEMA, EXTRACT_SYSTEM, budget);
  return { ...out, tests: Array.isArray(out.tests) ? out.tests : [] };
}

/* ---------------- Step 2: explain it ---------------- */

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    urgentMessage: { type: ["string", "null"] },
    tests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          plainName: { type: "string" },
          whatItMeasures: { type: "string" },
          whatYourResultMeans: { type: "string" },
        },
        required: ["id", "plainName", "whatItMeasures", "whatYourResultMeans"],
      },
    },
    questionsForDoctor: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "urgentMessage", "tests", "questionsForDoctor"],
};

function explainSystem(language: Language) {
  const lang = LANGUAGES.find((l) => l.code === language)?.prompt ?? "simple English";
  return `You help people in Nigeria understand their own lab results before or after seeing a doctor.
Write everything in ${lang}, at the reading level of a 12-year-old. Keep medical test names in English, then explain them.

Hard safety rules:
- The "status" and "critical" fields were computed by software from the lab's own reference range. They are final. Never contradict them, never call an out-of-range value "fine", never call a normal value "bad".
- Do NOT diagnose. Say what a result CAN be linked to ("can happen with…"), never what the person HAS.
- Do NOT recommend any medicine, supplement, herbal remedy or dose. Do NOT suggest self-medication.
- If any test is critical, urgentMessage must tell the person, calmly and clearly, to go to a hospital or call their doctor TODAY and bring this report. Otherwise urgentMessage is null.
- For status "unknown", say the report did not include a range so a health worker should interpret it.
- For a reactive/positive HIV, hepatitis or similar screening result: be gentle, explain that screening tests need a confirmatory test, and that treatment and counselling are available. No alarm, no judgement.
- One out-of-range value is often not serious on its own; say so where it is true, but always encourage discussing it with a doctor.
- Point to "a doctor", "a hospital" or "a health worker" — not "your GP".
- whatItMeasures: 1 sentence. whatYourResultMeans: 1-3 sentences, specific to this value.
- summary: 2-3 sentences covering the overall picture.
- questionsForDoctor: 3-5 short, specific questions the person can ask about THESE results.
- Return one tests entry for every input test, using the same id.`;
}

export async function explainResults(
  reportType: string,
  tests: FlaggedTest[],
  language: Language,
  budget: Budget,
): Promise<Explanation> {
  const payload = tests.map((t) => ({
    id: t.id,
    name: t.name,
    result: t.valueText,
    unit: t.unit,
    referenceRange: t.refText ?? (t.refLow !== null || t.refHigh !== null ? `${t.refLow ?? ""}–${t.refHigh ?? ""}` : null),
    status: t.status,
    critical: t.critical,
  }));
  const parts: Part[] = [
    { text: `Report type: ${reportType}\nResults:\n${JSON.stringify(payload, null, 2)}` },
  ];
  return generateJson<Explanation>(parts, EXPLAIN_SCHEMA, explainSystem(language), budget);
}
