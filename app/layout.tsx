import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ManakSetu — Verified Standards Intelligence",
  description: "Find the Indian Standards that apply to your tender, with the evidence behind every result.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
