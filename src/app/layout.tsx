import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";

const display = Instrument_Serif({
  variable: "--font-display-serif",
  subsets: ["latin", "latin-ext"],
  weight: "400",
});

const body = Inter({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: "LabLens — understand your lab results, safely",
  description:
    "Snap your lab report. Get a plain-language explanation in English, Pidgin, Yorùbá, Hausa or Igbo — with dangerous values flagged by code, not guessed by AI.",
};

export const viewport: Viewport = {
  themeColor: "#f6f3ec",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
