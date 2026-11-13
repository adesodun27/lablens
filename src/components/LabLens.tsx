"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyzeResponse, FlaggedTest, Language, Status, TestExplanation } from "@/lib/types";
import { LANGUAGES } from "@/lib/types";

type Stage = "idle" | "loading" | "result";

const STEPS = [
  "Reading your report…",
  "Checking each value against the lab's own range…",
  "Writing your explanation…",
];

const STATUS_STYLE: Record<Status, { label: string; chip: string }> = {
  normal: { label: "In range", chip: "bg-brand-soft text-brand" },
  low: { label: "Below range", chip: "bg-low-soft text-low" },
  high: { label: "Above range", chip: "bg-high-soft text-high" },
  abnormal: { label: "Not normal", chip: "bg-high-soft text-high" },
  unknown: { label: "No range given", chip: "bg-line text-muted" },
};

/* ---------- helpers ---------- */

async function compress(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/heic") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function shareText(r: AnalyzeResponse): string {
  const byId = new Map(r.explanation.tests.map((e) => [e.id, e]));
  const flagged = r.tests.filter((t) => t.status !== "normal");
  const lines = [
    `My ${r.extraction.reportType} results — explained by LabLens`,
    "",
    r.explanation.summary,
    "",
  ];
  if (flagged.length) {
    lines.push("To discuss:");
    for (const t of flagged) {
      lines.push(`• ${byId.get(t.id)?.plainName ?? t.name}: ${t.valueText}${t.unit ? " " + t.unit : ""} (${STATUS_STYLE[t.status].label}${t.critical ? ", URGENT" : ""})`);
    }
    lines.push("");
  }
  lines.push("Questions for my doctor:");
  r.explanation.questionsForDoctor.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
  lines.push("", "This is an explanation, not a diagnosis.");
  return lines.join("\n");
}

/* ---------- main ---------- */

export default function LabLens() {
  const [stage, setStage] = useState<Stage>("idle");
  const [files, setFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState<Language>("en");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [relang, setRelang] = useState(false);

  useEffect(() => {
    if (stage !== "loading") return;
    const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 3500);
    return () => clearInterval(id);
  }, [stage]);

  async function analyze(input: File[], lang: Language) {
    setError(null);
    setStep(0);
    setStage("loading");
    try {
      const fd = new FormData();
      const ready = await Promise.all(input.map(compress));
      ready.forEach((f) => fd.append("files", f));
      fd.append("language", lang);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setResult(data);
      setStage("result");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
      setStage("idle");
    }
  }

  async function switchLanguage(lang: Language) {
    setLanguage(lang);
    if (!result || lang === result.language) return;
    setRelang(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("language", lang);
      fd.append("extraction", JSON.stringify(result.extraction));
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRelang(false);
    }
  }

  async function trySample() {
    const blob = await fetch("/sample-report.png").then((r) => r.blob());
    const sample = new File([blob], "sample-report.png", { type: "image/png" });
    setFiles([sample]);
    analyze([sample], language);
  }

  function reset() {
    setStage("idle");
    setResult(null);
    setFiles([]);
    setError(null);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16">
      <Header onHome={stage === "result" ? reset : undefined} />

      {stage === "idle" && (
        <Upload
          files={files}
          setFiles={setFiles}
          language={language}
          setLanguage={setLanguage}
          error={error}
          onAnalyze={() => analyze(files, language)}
          onSample={trySample}
        />
      )}

      {stage === "loading" && <Loading step={step} />}

      {stage === "result" && result && (
        <Results
          result={result}
          language={language}
          onLanguage={switchLanguage}
          relang={relang}
          error={error}
          onReset={reset}
        />
      )}

      <Footer />
    </div>
  );
}

/* ---------- sections ---------- */

function Header({ onHome }: { onHome?: () => void }) {
  return (
    <header className="flex items-center justify-between py-6">
      <button
        onClick={onHome}
        className="font-display text-3xl leading-none tracking-tight disabled:cursor-default"
        disabled={!onHome}
        aria-label="LabLens home"
      >
        LabLens
      </button>
      <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">
        Nothing is saved
      </span>
    </header>
  );
}

function LanguagePicker({
  value,
  onChange,
  disabled,
}: {
  value: Language;
  onChange: (l: Language) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Explanation language" className="flex flex-wrap gap-2">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          role="radio"
          aria-checked={value === l.code}
          disabled={disabled}
          onClick={() => onChange(l.code)}
          className={`rounded-full border px-4 py-2 text-sm transition disabled:opacity-50 ${
            value === l.code
              ? "border-ink bg-ink text-paper"
              : "border-line bg-card text-ink hover:border-ink/40"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function Upload(props: {
  files: File[];
  setFiles: (f: File[]) => void;
  language: Language;
  setLanguage: (l: Language) => void;
  error: string | null;
  onAnalyze: () => void;
  onSample: () => void;
}) {
  const { files, setFiles, language, setLanguage, error, onAnalyze, onSample } = props;
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previews = useMemo(
    () => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [files],
  );
  useEffect(() => () => previews.forEach((p) => p && URL.revokeObjectURL(p)), [previews]);

  function add(list: FileList | null) {
    if (!list) return;
    setFiles([...files, ...Array.from(list)].slice(0, 4));
  }

  return (
    <main>
      <h1 className="font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
        Understand your lab results.
        <span className="block text-brand">Safely.</span>
      </h1>
      <p className="mt-4 max-w-lg text-lg text-muted">
        Snap your report. Get every value explained in plain words — with dangerous results
        flagged by fixed medical rules, not guessed by AI.
      </p>

      <section className="mt-8 rounded-3xl border border-line bg-card p-5 sm:p-6">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => cameraRef.current?.click()}
            className="rounded-2xl bg-ink px-4 py-4 text-left text-paper"
          >
            <span className="block text-sm opacity-70">Take a</span>
            <span className="text-lg font-medium">Photo</span>
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="rounded-2xl border border-line px-4 py-4 text-left"
          >
            <span className="block text-sm text-muted">Upload</span>
            <span className="text-lg font-medium">Image or PDF</span>
          </button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.target.files)} />
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => add(e.target.files)} />

        {files.length > 0 && (
          <ul className="mt-4 flex gap-3 overflow-x-auto">
            {files.map((f, i) => (
              <li key={i} className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-paper">
                {previews[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previews[i]!} alt={`Page ${i + 1}`} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-muted">PDF</span>
                )}
                <button
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  className="absolute right-1 top-1 h-6 w-6 rounded-full bg-ink/80 text-xs text-paper"
                  aria-label={`Remove page ${i + 1}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-6 mb-3 text-sm font-medium">Explain it in</p>
        <LanguagePicker value={language} onChange={setLanguage} />

        {error && (
          <p role="alert" className="mt-5 rounded-xl bg-urgent-soft px-4 py-3 text-sm text-urgent">
            {error}
          </p>
        )}

        <button
          onClick={onAnalyze}
          disabled={files.length === 0}
          className="mt-6 w-full rounded-2xl bg-brand px-5 py-4 text-lg font-medium text-white transition disabled:opacity-40"
        >
          Explain my results
        </button>
        <button onClick={onSample} className="mt-3 w-full py-2 text-sm text-muted underline underline-offset-4">
          No report handy? Try a sample
        </button>
      </section>

      <ul className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          ["AI reads, rules judge", "The AI only copies values off the page. Whether a value is high, low or dangerous is decided by code using the lab's own range."],
          ["Urgent values, loudly", "Results in the danger zone trigger a clear “go to a hospital today” warning that the AI can't soften."],
          ["Private by design", "Your report isn't saved anywhere, and names or hospital numbers are never pulled from it."],
        ].map(([t, d]) => (
          <li key={t} className="rounded-2xl border border-line p-4">
            <p className="font-medium">{t}</p>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Loading({ step }: { step: number }) {
  return (
    <main className="py-16" aria-live="polite">
      <ol className="space-y-4">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-3 text-lg ${i > step ? "text-muted/50" : ""}`}>
            <span
              className={`h-3 w-3 rounded-full ${
                i < step ? "bg-brand" : i === step ? "bg-brand pulse-dot" : "bg-line"
              }`}
            />
            {s}
          </li>
        ))}
      </ol>
    </main>
  );
}

function Results(props: {
  result: AnalyzeResponse;
  language: Language;
  onLanguage: (l: Language) => void;
  relang: boolean;
  error: string | null;
  onReset: () => void;
}) {
  const { result, language, onLanguage, relang, error, onReset } = props;
  const [copied, setCopied] = useState(false);
  const byId = useMemo(() => new Map(result.explanation.tests.map((e) => [e.id, e])), [result]);
  const critical = result.tests.filter((t) => t.critical);
  const counts = {
    normal: result.tests.filter((t) => t.status === "normal").length,
    out: result.tests.filter((t) => ["low", "high", "abnormal"].includes(t.status)).length,
    unknown: result.tests.filter((t) => t.status === "unknown").length,
  };
  const text = shareText(result);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className={relang ? "opacity-50 transition" : "transition"}>
      {critical.length > 0 && (
        <section role="alert" className="mb-6 rounded-3xl border-2 border-urgent bg-urgent-soft p-5">
          <p className="text-sm font-semibold uppercase tracking-wide text-urgent">See a doctor today</p>
          <p className="mt-2 font-medium text-ink">
            {critical.length === 1 ? "One result is" : `${critical.length} results are`} in a range that needs
            medical attention today. Go to a hospital or call your doctor and bring this report.
          </p>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink/80">
            {critical.map((t) => (
              <li key={t.id}>{t.criticalReason}</li>
            ))}
          </ul>
          {result.explanation.urgentMessage && language !== "en" && (
            <p className="mt-3 border-t border-urgent/20 pt-3 text-ink">{result.explanation.urgentMessage}</p>
          )}
        </section>
      )}

      <p className="text-sm text-muted">{result.extraction.reportType}</p>
      <h1 className="mt-1 font-display text-4xl leading-tight tracking-tight">Here&apos;s what your results say</h1>
      <p className="mt-4 text-lg leading-relaxed">{result.explanation.summary}</p>

      <div className="mt-6 grid grid-cols-3 gap-3 text-center">
        <Stat n={counts.normal} label="In range" tone="text-brand" />
        <Stat n={counts.out} label="Outside range" tone="text-high" />
        <Stat n={counts.unknown} label="No range given" tone="text-muted" />
      </div>

      <div className="mt-8">
        <p className="mb-3 text-sm font-medium">Explanation language</p>
        <LanguagePicker value={language} onChange={onLanguage} disabled={relang} />
        {error && <p className="mt-3 text-sm text-urgent">{error}</p>}
      </div>

      <ul className="mt-8 space-y-4">
        {result.tests.map((t) => (
          <TestCard key={t.id} test={t} exp={byId.get(t.id)} />
        ))}
      </ul>

      <section className="mt-10 rounded-3xl bg-ink p-6 text-paper">
        <h2 className="font-display text-3xl">Ask your doctor</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5">
          {result.explanation.questionsForDoctor.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl bg-paper px-4 py-3 text-center font-medium text-ink"
          >
            Send on WhatsApp
          </a>
          <button onClick={copy} className="rounded-2xl border border-paper/30 px-4 py-3 font-medium">
            {copied ? "Copied" : "Copy summary"}
          </button>
        </div>
      </section>

      <button onClick={onReset} className="mt-8 w-full rounded-2xl border border-line py-4 font-medium">
        Explain another report
      </button>
    </main>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card py-4">
      <p className={`font-display text-4xl ${tone}`}>{n}</p>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

function TestCard({ test, exp }: { test: FlaggedTest; exp?: TestExplanation }) {
  const s = STATUS_STYLE[test.status];
  return (
    <li
      className={`rounded-3xl border bg-card p-5 ${test.critical ? "border-urgent border-2" : "border-line"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{exp?.plainName ?? test.name}</p>
          {exp?.plainName && exp.plainName !== test.name && <p className="text-xs text-muted">{test.name}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${test.critical ? "bg-urgent text-white" : s.chip}`}>
          {test.critical ? "Urgent" : s.label}
        </span>
      </div>

      <p className="mt-3 font-display text-3xl">
        {test.valueText}
        {test.unit && <span className="ml-1 font-sans text-base text-muted">{test.unit}</span>}
      </p>

      {test.position !== null ? (
        <div className="mt-3">
          <div className="range-track relative h-2 rounded-full">
            <span
              className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-ink shadow"
              style={{ left: `${test.position * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between px-[25%] text-[11px] text-muted">
            <span>{test.refLow}</span>
            <span>{test.refHigh}</span>
          </div>
        </div>
      ) : (
        test.refText && <p className="mt-1 text-xs text-muted">Normal: {test.refText}</p>
      )}

      {exp && (
        <div className="mt-4 space-y-2 border-t border-line pt-4 text-[15px] leading-relaxed">
          <p className="text-muted">{exp.whatItMeasures}</p>
          <p>{exp.whatYourResultMeans}</p>
        </div>
      )}
    </li>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-line pt-6 text-xs leading-relaxed text-muted">
      LabLens explains lab results; it does not diagnose or prescribe. Always discuss your results with a
      qualified health worker. If you feel very unwell, go to the nearest hospital.
    </footer>
  );
}
