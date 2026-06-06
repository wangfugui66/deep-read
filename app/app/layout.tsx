import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FluxRead — The Interactive Knowledge Sandbox",
  description: "AI 深度阅读助手 — 流变涌现 · 深度摄入",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-neutral-50 text-neutral-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}
