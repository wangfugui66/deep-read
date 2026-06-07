"use client";

import { ChevronLeft, Loader2, Sparkles, ArrowRight, Clapperboard } from "lucide-react";
import { useReaderStore } from "@/lib/stores/readerStore";
import type { ChapterRef, SkeletonTocData } from "@/lib/types";
import TeachAnyButton from "@/app/components/reader/TeachAnyButton";

type Theme = "day" | "warm" | "night";
const BOTTOM_BG: Record<Theme, string> = {
  day: "bg-[#F9F7F3]",
  warm: "bg-[#f5f0e8]",
  night: "bg-[#1a1a2e]",
};

const BOTTOM_TEXT: Record<Theme, string> = {
  day: "text-neutral-600",
  warm: "text-neutral-600",
  night: "text-gray-300",
};

interface Props {
  bookName: string;
  chapters: ChapterRef[];
  currentPath: string;
  chapterContent: string;
  chapterStrategy?: string;
  quizGenerating?: boolean;
  skeletonToc?: SkeletonTocData | null;
  onGenerateAnimation?: (paths: string[]) => void;
  onNavigate: (path: string) => void;
}

export default function BottomNav({ bookName, chapters, currentPath, chapterContent, chapterStrategy, quizGenerating, skeletonToc, onGenerateAnimation, onNavigate }: Props) {
  const { theme, readingMode } = useReaderStore();
  const sorted = [...chapters].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
  );

  const idx = sorted.findIndex((ch) => ch.path === currentPath);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

  // ── Determine current chapter strategy from skeleton TOC ──
  // Triple-lock: intensive mode + dynamic_toc loaded + current chapter explicitly "精读"
  const getStrategy = (): string => {
    if (!skeletonToc) return "";
    const allChapters = [
      ...(skeletonToc.modules ?? []).flatMap((m) => m.chapters ?? []),
      ...(skeletonToc.archived_chapters ?? []),
    ];
    if (allChapters.length === 0) return "";
    // Robust matching: handle URL encoding, leading slash, path separators
    const normalize = (p: string) => {
      try { return decodeURIComponent(p).replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase(); }
      catch { return p.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase(); }
    };
    const target = normalize(currentPath);
    const match = allChapters.find((ch) => {
      const fp = normalize(ch.file_path ?? "");
      return fp === target || fp.endsWith("/" + target) || target.endsWith("/" + fp);
    });
    const result = match?.strategy?.trim() ?? "";
    console.log("[BottomNav] strategy lookup:", { currentPath, target, strategy: result, allCount: allChapters.length });
    return result;
  };
  const strategy = getStrategy();
  // Gate: "精读" strategy AND NOT immersive mode → show quiz-style button
  // In immersive mode, intensive chapters are treated as normal (no quiz gate)
  const isIntensive = !!(skeletonToc && strategy === "精读" && readingMode !== "immersive");

  // ── Animation gatekeeper (synced with TeachAnyButton: wordCount < 1000) ──
  const wordCount = chapterContent?.length || 0;
  const animationTooShort = wordCount < 1000;

  return (
    <div className={`flex items-center justify-center gap-12 px-4 py-6 !border-none !shadow-none sticky bottom-0 z-50 ${BOTTOM_BG[theme]} ${BOTTOM_TEXT[theme]}`}>
      <button
        onClick={() => prev && onNavigate(prev.path)}
        disabled={!prev}
        className="inline-flex items-center gap-1 px-4 py-2 text-xs rounded-md border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
      >
        <ChevronLeft size={14} />
        上一章
      </button>

      <span className="text-[10px] text-neutral-400 tabular-nums min-w-[40px] text-center">
        {idx + 1} / {sorted.length}
      </span>

      {/* Knowledge sandbox — hidden in immersive */}
      {readingMode !== "immersive" && (
        <TeachAnyButton
          bookName={bookName}
          chapterPath={currentPath}
          chapterContent={chapterContent}
          chapterStrategy={chapterStrategy}
        />
      )}

      {/* Knowledge animation — sync gatekeeper with TeachAny: wordCount >= 1000 */}
      {readingMode !== "immersive" && onGenerateAnimation && (
        <button
          onClick={() => onGenerateAnimation([currentPath])}
          disabled={animationTooShort}
          title={animationTooShort
            ? "本节内容较少（不足1000字），请使用左侧目录的章节聚合入口生成知识动画"
            : "生成知识动画"}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-md border transition-all ${
            animationTooShort
              ? "bg-neutral-100 text-neutral-350 cursor-not-allowed opacity-60 border-neutral-200"
              : "border-purple-200 text-purple-700 bg-purple-50 hover:bg-purple-100"
          }`}
        >
          <Clapperboard size={14} />
          知识动画
        </button>
      )}

      <button
        onClick={() => next && onNavigate(next.path)}
        disabled={!next || quizGenerating}
        className={`inline-flex items-center gap-1 px-4 py-2 text-xs rounded-md border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
          isIntensive
            ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
            : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
        }`}
      >
        {quizGenerating ? (
          <Loader2 size={14} className="animate-spin" />
        ) : isIntensive ? (
          <Sparkles size={14} />
        ) : (
          <ArrowRight size={14} />
        )}
        {quizGenerating
          ? "生成测试中…"
          : isIntensive
            ? "下一章 (通关测试)"
            : "下一章"}
      </button>
    </div>
  );
}
