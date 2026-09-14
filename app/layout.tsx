import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ManakSetu AI — Standards Intelligence",
  description: "Verified Indian Standards recommendations for safer, faster public procurement.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
