import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LabelDesk — Release review",
  description: "Inspect frozen labels, challenge a specific row, and compare supported dataset releases.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
