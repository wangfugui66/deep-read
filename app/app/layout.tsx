import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeepRead-v2",
  description: "AI 深度阅读助手 — 知识网格 · 极简摄入",
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
