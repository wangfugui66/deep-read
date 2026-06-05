"use client";

import { useRouter } from "next/navigation";
import { useState, useCallback, useRef } from "react";
import { Search, ExternalLink, Bookmark, Bot, ChevronLeft } from "lucide-react";
import { useReaderStore, FONT_SIZES } from "@/lib/stores/readerStore";
import { dictionaryLookup } from "@/lib/api_client";
import type { FontSize } from "@/lib/stores/readerStore";
import type { DictionaryCard } from "@/lib/types";

interface Props {
  bookName: string;
}

type Theme = "day" | "warm" | "night";
const HEADER_BG: Record<Theme, string> = {
  day: "bg-[#F9F7F3]",
  warm: "bg-[#f5f0e8]",
  night: "bg-[#1a1a2e]",
};

const HEADER_TEXT: Record<Theme, string> = {
  day: "text-neutral-600",
  warm: "text-neutral-600",
  night: "text-gray-300",
};

/** Inline header bar inside the reading column — search, mode toggle, font size. */
export default function InnerReaderHeader({ bookName }: Props) {
  const {
    fontSize,
    readingMode,
    setFontSize,
    setReadingMode,
    theme,
    setChapter,
    setHighlightQuery,
  } = useReaderStore();
  const router = useRouter();

  // ── Search state ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DictionaryCard | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setSearchResults(null);
        return;
      }
      setSearchLoading(true);
      try {
        const result = await dictionaryLookup(bookName, q);
        setSearchResults(result);
      } catch {
        setSearchResults(null);
      } finally {
        setSearchLoading(false);
      }
    },
    [bookName],
  );

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(val), 400);
  };

  const navigateToMatch = (file: string) => {
    const chapterPath = file.replace(/\\/g, "/");
    const title = file.replace(/\.md$/i, "").replace(/^\d+_/, "");
    const q = searchQuery.trim();
    setChapter(chapterPath, title);
    setHighlightQuery(q || null);
    setSearchOpen(false);
    setSearchQuery("");
  };

  return (
    <div className={`flex items-center justify-center gap-6 py-4 !border-none !shadow-none !ring-0 !outline-none sticky top-0 z-50 ${HEADER_BG[theme]} ${HEADER_TEXT[theme]}`}>
      {/* ── Back to bookshelf ── */}
      <button
        onClick={() => router.push("/books")}
        className="flex items-center gap-1 shrink-0 px-2.5 py-1.5 text-xs rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
        title="返回书架"
      >
        <ChevronLeft size={13} />
        <span className="hidden sm:inline">书架</span>
      </button>

      {/* ── Search bar ── */}
      <div className="flex-1 max-w-md relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
          placeholder="搜索概念、人物、术语…"
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300 focus:bg-white transition-colors"
        />
        {searchOpen && searchQuery.trim() && (
          <div className="absolute top-full mt-1 w-full bg-white border border-neutral-200 rounded-md shadow-lg z-50 max-h-80 overflow-y-auto">
            {searchLoading && <div className="px-3 py-3 text-xs text-neutral-400 text-center">搜索中…</div>}
            {!searchLoading && searchResults && (
              <div className="p-2">
                <div className="text-xs font-medium text-neutral-700 px-1 mb-1">{searchResults.term}</div>
                <div className="text-xs text-neutral-600 leading-relaxed px-1 mb-1">{searchResults.definition}</div>
                {searchResults.matches && searchResults.matches.length > 0 && (
                  <div className="border-t border-neutral-100 pt-1 mt-1">
                    <div className="text-[10px] text-neutral-400 px-1 mb-1">
                      定位到章节 · {searchResults.match_count} 处匹配
                    </div>
                    {searchResults.matches.slice(0, 5).map((m, i) => (
                      <button
                        key={i}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => navigateToMatch(m.file)}
                        className="w-full text-left px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 rounded flex items-start gap-1.5 group"
                      >
                        <ExternalLink size={10} className="mt-0.5 shrink-0 text-neutral-300 group-hover:text-neutral-500" />
                        <span className="line-clamp-2 text-[11px] leading-snug">{m.snippet}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-neutral-300 mt-1 px-1">匹配 {searchResults.match_count} 处</div>
              </div>
            )}
            {!searchLoading && !searchResults && searchQuery.trim().length >= 2 && (
              <div className="px-3 py-3 text-xs text-neutral-400 text-center">未找到相关结果</div>
            )}
          </div>
        )}
      </div>

      {/* ── Reading mode toggle ── */}
      <button
        onClick={() => setReadingMode(readingMode === "immersive" ? "intensive" : "immersive")}
        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border transition-all duration-200 shrink-0 ${
          readingMode === "immersive"
            ? "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
            : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
        }`}
        title={readingMode === "immersive" ? "切换到 AI 精读" : "切换到沉浸式阅读"}
      >
        {readingMode === "immersive" ? (
          <><Bookmark size={13} /><span className="hidden sm:inline">沉浸式</span></>
        ) : (
          <><Bot size={13} /><span className="hidden sm:inline">AI 精读</span></>
        )}
      </button>

      {/* ── Font size selector ── */}
      <select
        value={fontSize}
        onChange={(e) => setFontSize(Number(e.target.value) as FontSize)}
        className="px-2 py-1.5 text-xs border border-neutral-200 rounded-md bg-white text-neutral-600 cursor-pointer hover:bg-neutral-50 transition-colors appearance-none shrink-0"
        title="字号"
      >
        {FONT_SIZES.map((s) => (
          <option key={s} value={s}>{s}px</option>
        ))}
      </select>
    </div>
  );
}
