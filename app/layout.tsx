import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NoLoop",
  description:
    "Autonomous health-insurance claim adjudication — bridging hospitals, insurers, and patients.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
