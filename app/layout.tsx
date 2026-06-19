import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NoLoop — Cashless claims in 60 seconds",
  description:
    "NoLoop connects hospitals and insurers on a single AI-powered platform — cutting claim turnaround from hours to seconds.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700,800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
