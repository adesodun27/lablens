# LabLens — see what your lab results mean

**DSH Hacks V2 · AI × Healthcare**

## The problem
In Nigeria, many people pay for a lab test and pick up the result themselves, often before they see a doctor and sometimes without ever seeing one. The report is full of abbreviations, units and ranges they can't read. So they guess, panic, ignore it, or paste it into a general chatbot. That chatbot can make up a "normal" range, play down a dangerous value, and leaves their health data with a third party.

## What LabLens does
1. **Snap or upload** the report: a photo, several pages, or a PDF.
2. **The AI reads it.** Gemini copies each test, value, unit and the lab's own printed reference range into structured JSON. It is told never to invent a range and never to pull out names, phone numbers or hospital numbers.
3. **Code judges it.** Plain TypeScript (`src/lib/flags.ts`) compares each value with the lab's range and marks it low, high, normal or not normal. A separate list of **critical-value thresholds** (haemoglobin, potassium, sodium, glucose, platelets, WBC, creatinine, calcium) triggers a "see a doctor today" banner. The AI cannot override this.
4. **The AI explains it** in English, Nigerian Pidgin, Yorùbá, Hausa or Igbo. It receives the code's verdicts as fixed facts and must follow these rules: no diagnosis, no medicines, no doses, a gentle approach for reactive HIV or hepatitis screens, and 3–5 questions to ask the doctor.
5. **Share** the summary and questions on WhatsApp, or copy them to take to the appointment.

## Why it's safe by design
| Risk with a generic chatbot | LabLens |
|---|---|
| Invents reference ranges | Uses only ranges printed on the report; if none is printed the result shows "No range given" |
| Calls a dangerous value "slightly low" | Critical thresholds live in code and the urgent banner is always shown in English |
| Diagnoses or suggests drugs | Forbidden in the prompt; explanations say "can be linked to", never "you have" |
| Keeps your data | Nothing is stored. Files stay in memory for one request and personal identifiers are never extracted |

## Tech
Next.js 16 (App Router) · TypeScript · Tailwind v4 · Google Gemini (`@google/genai`, structured JSON output, vision) · Vercel

```
src/lib/flags.ts        deterministic status + critical-value rules
src/lib/gemini.ts       step 1 extract (vision) · step 2 explain (language)
src/app/api/analyze     POST endpoint, no storage
src/components/LabLens.tsx the whole UI
public/sample-report.png fictional report for demos
```

## Run locally
```bash
npm install
cp .env.example .env.local   # add your GEMINI_API_KEY from https://aistudio.google.com/apikey
npm run dev
```
`GEMINI_MOCK=1` runs the app with canned data and makes no API calls.

## Deploy
Push to GitHub → import into Vercel → add `GEMINI_API_KEY` under Environment Variables → Deploy.

## Limitations and next steps
- The critical thresholds come from commonly published lab critical-value lists and **need clinician review** before real-world use.
- Gemini's free API tier may use inputs to improve Google's products. A production version should use a paid or zero-retention tier.
- Next: offline PWA, history the user controls on their own device, trend charts across reports, and a review loop with Nigerian lab scientists and doctors.

*LabLens explains lab results. It does not diagnose or prescribe.*
