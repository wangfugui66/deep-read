import { create } from "zustand";
import type { BookMeta, ChapterRef } from "@/lib/types";
import type { QuizQuestion } from "@/app/components/reader/QuizModal";

// ====================================================================
// Reader Store — global reading state: preferences + book data + UI + quiz
// ====================================================================

export const FONT_SIZES = [14, 16, 18, 20, 22, 24] as const;
export type FontSize = (typeof FONT_SIZES)[number];
export type Theme = "day" | "warm" | "night";
export type ReadingMode = "immersive" | "intensive";

export interface ReaderState {
  // ── Persistent preferences (localStorage-backed) ──
  activeBookName: string | null;
  currentChapterPath: string | null;
  currentChapterTitle: string | null;
  highlightQuery: string | null;
  fontSize: FontSize;
  theme: Theme;
  readingMode: ReadingMode;

  // ── Book & chapter data (transient, per-session) ──
  book: BookMeta | null;
  chapters: ChapterRef[];
  body: string | null;
  loading: boolean;
  error: string | null;

  // ── UI state ──
  tocOpen: boolean;
  wizardOpen: boolean;

  // ── Skeleton ──
  skeletonRefreshKey: number;
  isGeneratingSkeleton: boolean;

  // ── AI indexing ──
  indexingStatus: string;  // "pending" | "processing" | "completed"
  indexedCount: number;
  totalCount: number;

  // ── Quiz gatekeeper ──
  quizOpen: boolean;
  quizQuestions: QuizQuestion[];
  quizGenerating: boolean;
  pendingChapter: string | null;
}

export interface ReaderActions {
  // Book scope
  setActiveBook: (name: string) => void;

  // Chapter navigation
  setChapter: (path: string, title: string) => void;

  // Search highlight
  setHighlightQuery: (query: string | null) => void;

  // Display preferences (persistent)
  setFontSize: (size: FontSize) => void;
  setTheme: (theme: Theme) => void;
  setReadingMode: (mode: ReadingMode) => void;

  // Book data (transient)
  setBookMeta: (book: BookMeta | null) => void;
  setChapters: (chapters: ChapterRef[]) => void;
  setBody: (body: string | null) => void;
  setPageLoading: (loading: boolean) => void;
  setPageError: (error: string | null) => void;

  // UI state
  setTocOpen: (open: boolean) => void;
  toggleToc: () => void;
  setWizardOpen: (open: boolean) => void;

  // Skeleton
  setSkeletonRefreshKey: (key: number) => void;
  bumpSkeletonRefreshKey: () => void;
  setIsGeneratingSkeleton: (v: boolean) => void;

  // AI indexing
  setIndexingStatus: (status: string) => void;
  setIndexingProgress: (indexed: number, total: number) => void;

  // Quiz gatekeeper
  setQuizOpen: (open: boolean) => void;
  setQuizQuestions: (qs: QuizQuestion[]) => void;
  setQuizGenerating: (v: boolean) => void;
  setPendingChapter: (path: string | null) => void;

  // Init from localStorage
  init: () => void;
}

export const useReaderStore = create<ReaderState & ReaderActions>((set) => ({
  // ── Initial values ──
  activeBookName: null,
  currentChapterPath: null,
  currentChapterTitle: null,
  highlightQuery: null,
  fontSize: 18,
  theme: "day",
  readingMode: "immersive",

  book: null,
  chapters: [],
  body: null,
  loading: true,
  error: null,

  tocOpen: false,
  wizardOpen: false,

  skeletonRefreshKey: 0,
  isGeneratingSkeleton: false,

  indexingStatus: "pending",
  indexedCount: 0,
  totalCount: 0,

  quizOpen: false,
  quizQuestions: [],
  quizGenerating: false,
  pendingChapter: null,

  // ── Persistent actions ──

  setActiveBook: (name) => set({ activeBookName: name }),

  setChapter: (path, title) => set({ currentChapterPath: path, currentChapterTitle: title }),

  setHighlightQuery: (query) => set({ highlightQuery: query }),

  setFontSize: (size) => {
    set({ fontSize: size });
    if (typeof window !== "undefined") localStorage.setItem("dr-fontSize", String(size));
  },

  setTheme: (theme) => {
    set({ theme });
    if (typeof window !== "undefined") localStorage.setItem("dr-theme", theme);
  },

  setReadingMode: (mode) => {
    set({ readingMode: mode });
    if (typeof window !== "undefined") localStorage.setItem("dr-readingMode", mode);
  },

  // ── Transient book data actions ──

  setBookMeta: (book) => set({ book }),

  setChapters: (chapters) => set({ chapters }),

  setBody: (body) => set({ body }),

  setPageLoading: (loading) => set({ loading }),

  setPageError: (error) => set({ error }),

  // ── UI state actions ──

  setTocOpen: (tocOpen) => set({ tocOpen }),
  toggleToc: () => set((s) => ({ tocOpen: !s.tocOpen })),
  setWizardOpen: (wizardOpen) => set({ wizardOpen }),

  // ── Skeleton actions ──

  setSkeletonRefreshKey: (skeletonRefreshKey) => set({ skeletonRefreshKey }),
  bumpSkeletonRefreshKey: () => set((s) => ({ skeletonRefreshKey: s.skeletonRefreshKey + 1 })),
  setIsGeneratingSkeleton: (isGeneratingSkeleton) => set({ isGeneratingSkeleton }),

  setIndexingStatus: (indexingStatus) => set({ indexingStatus }),
  setIndexingProgress: (indexedCount, totalCount) => set({ indexedCount, totalCount }),

  // ── Quiz gatekeeper actions ──

  setQuizOpen: (quizOpen) => set({ quizOpen }),
  setQuizQuestions: (quizQuestions) => set({ quizQuestions }),
  setQuizGenerating: (quizGenerating) => set({ quizGenerating }),
  setPendingChapter: (pendingChapter) => set({ pendingChapter }),

  // ── Init from localStorage ──

  init: () => {
    if (typeof window !== "undefined") {
      const savedFont = localStorage.getItem("dr-fontSize");
      const savedTheme = localStorage.getItem("dr-theme") as Theme | null;
      const savedMode = localStorage.getItem("dr-readingMode") as ReadingMode | null;
      const updates: Partial<ReaderState> = {};
      const f = Number(savedFont);
      if (f && FONT_SIZES.includes(f as FontSize)) updates.fontSize = f as FontSize;
      if (savedTheme && ["day", "warm", "night"].includes(savedTheme)) updates.theme = savedTheme;
      if (savedMode && ["immersive", "intensive"].includes(savedMode)) updates.readingMode = savedMode;
      if (Object.keys(updates).length) set(updates);
    }
  },
}));
