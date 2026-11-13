import { Budget, BusyError, extractReport, explainResults } from "@/lib/gemini";
import { flagTests, sortTests } from "@/lib/flags";
import type { AnalyzeResponse, Extraction, Language } from "@/lib/types";
import { LANGUAGES } from "@/lib/types";
import { MOCK_EXTRACTION, mockExplanation } from "@/lib/mock";

const MOCK = process.env.GEMINI_MOCK === "1";

export const maxDuration = 120;
const BUDGET_MS = 100_000; // answer the browser before Vercel's limit

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX_FILES = 4;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // stay under Vercel's 4.5MB body limit

/**
 * POST multipart/form-data
 *   files[]   – report images / PDF (first run)
 *   language  – en | pcm | yo | ha | ig
 *   extraction – JSON, optional: skip reading the report again (language switch)
 *
 * Nothing is stored. Files live in memory for the length of this request.
 */
export async function POST(req: Request) {
  const budget = new Budget(BUDGET_MS);
  try {
    const form = await req.formData();
    const langRaw = String(form.get("language") ?? "en");
    const language: Language = LANGUAGES.some((l) => l.code === langRaw) ? (langRaw as Language) : "en";

    let extraction: Extraction;
    const cached = form.get("extraction");

    if (typeof cached === "string" && cached) {
      extraction = JSON.parse(cached) as Extraction;
    } else {
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      if (files.length === 0) return error("Add a photo or PDF of your lab report.", 400);
      if (files.length > MAX_FILES) return error(`Up to ${MAX_FILES} pages at a time.`, 400);
      const total = files.reduce((n, f) => n + f.size, 0);
      if (total > MAX_TOTAL_BYTES) return error("Those files are too large. Try clearer, smaller photos.", 413);
      for (const f of files) {
        if (!ALLOWED.includes(f.type)) return error("Use a JPG, PNG or PDF.", 415);
      }
      const payload = await Promise.all(
        files.map(async (f) => ({
          mimeType: f.type,
          data: Buffer.from(await f.arrayBuffer()).toString("base64"),
        })),
      );
      extraction = MOCK ? MOCK_EXTRACTION : await extractReport(payload, budget);
    }

    if (!extraction.isLabReport || extraction.tests.length === 0) {
      return error("We couldn't find lab results in that. Try a clearer photo of the results page.", 422);
    }

    const tests = sortTests(flagTests(extraction.tests));
    const explanation = MOCK
      ? mockExplanation(tests)
      : await explainResults(extraction.reportType, tests, language, budget);

    const body: AnalyzeResponse = { extraction, tests, explanation, language };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[analyze]", err);
    if (err instanceof BusyError)
      return error("The AI is very busy right now. Please try again in a minute.", 503);
    const msg = String((err as Error)?.message ?? "");
    if (/GEMINI_API_KEY/.test(msg)) return error("Server is missing its Gemini API key.", 500);
    if (/429|quota|rate/i.test(msg)) return error("Too many requests right now. Wait a minute and try again.", 429);
    if (/503|UNAVAILABLE|high demand|overloaded/i.test(msg))
      return error("The AI is very busy right now. Please try again in a minute.", 503);
    return error("Something went wrong reading the report. Please try again.", 500);
  }
}

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}
