import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ManakSetu — Verified Standards Intelligence",
  description: "Find the Indian Standards that apply to your tender, with the evidence behind every result.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Nunito carries the friendly rounded voice; Caveat is the handwritten
            accent for the little margin notes. Indic text falls back to the
            system's Devanagari / Telugu / Tamil faces. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Caveat:wght@600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
