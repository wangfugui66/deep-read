"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useRef } from "react";
import { fetchBookMeta, fetchChapters, fetchChapterContent, generateSkeleton, fetchQuizQuestions, fetchDynamicToc } from "@/lib/api_client";
import { useReaderStore } from "@/lib/stores/readerStore";
import { useChatStore } from "@/lib/stores/chatStore";
import type { SkeletonTocData } from "@/lib/types";
import QuizModal from "@/app/components/reader/QuizModal";
import KnowledgeAnimationModal from "@/app/components/reader/KnowledgeAnimationModal";

import TopBar from "@/app/components/layout/TopBar";
import TocDrawer from "@/app/components/nav/TocDrawer";
import ReaderView from "@/app/components/reader/ReaderView";
import ChatPanel from "@/app/components/chat/ChatPanel";
import GraphModal from "@/app/components/book/GraphModal";
import ProfileWizardModal from "@/app/components/profile/ProfileWizardModal";
import BottomNav from "@/app/components/reader/BottomNav";
import InnerReaderHeader from "@/app/components/reader/InnerReaderHeader";
import SelectionToolbar from "@/app/components/reader/SelectionToolbar";

const THEME_BG: Record<string, string> = {
  day: "bg-[#F9F7F3]",
  warm: "bg-[#f5f0e8]",
  night: "bg-[#1a1a2e]",
};

export default function ReadPage() {
  const { bookName: rawBookName } = useParams<{ bookName: string }>();
  const bookName = decodeURIComponent(rawBookName);
  const router = useRouter();

  const {
    chapters,
    body,
    loading,
    error,
    tocOpen,
    skeletonRefreshKey,
    isGeneratingSkeleton,
    quizOpen,
    quizQuestions,
    quizGenerating,
    pendingChapter,
    currentChapterPath,
    currentChapterTitle,
    readingMode,
    theme,
    setChapter,
    setActiveBook,
    init: initStore,
    setBookMeta,
    setChapters,
    setBody,
    setPageLoading,
    setPageError,
    setTocOpen,
    setWizardOpen,
    bumpSkeletonRefreshKey,
    setIsGeneratingSkeleton,
    setQuizOpen,
    setQuizQuestions,
    setQuizGenerating,
    setPendingChapter,
  } = useReaderStore();

  const [notFound, setNotFound] = useState(false);
  const [skeletonToc, setSkeletonToc] = useState<SkeletonTocData | null>(null);
  // Ref mirror for always-fresh reads inside stable callbacks (avoids stale closure)
  const skeletonTocRef = useRef<SkeletonTocData | null>(null);
  skeletonTocRef.current = skeletonToc;
  const [isAnimationOpen, setIsAnimationOpen] = useState(false);
  const [animationHtml, setAnimationHtml] = useState<string | null>(null);
  const [isAnimationLoading, setIsAnimationLoading] = useState(false);
  const chatStore = useChatStore();

  const handleProfileComplete = useCallback(() => {
    setWizardOpen(false);
    setTocOpen(true);
    setIsGeneratingSkeleton(true);
    generateSkeleton(bookName)
      .then(() => {
        setIsGeneratingSkeleton(false);
        bumpSkeletonRefreshKey();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        alert("骨架生成失败: " + msg);
        setIsGeneratingSkeleton(false);
      });
  }, [bookName, setWizardOpen, setTocOpen, setIsGeneratingSkeleton, bumpSkeletonRefreshKey]);

  const handleGenerateAnimation = useCallback((targetPaths: string[]) => {
    console.log("[KnowledgeAnimation] targetPaths:", targetPaths);
    setIsAnimationOpen(true);
    setIsAnimationLoading(true);
    setAnimationHtml(null);
    setTimeout(() => {
      setIsAnimationLoading(false);
    }, 3000);
  }, []);

  const goToChapter = useCallback(
    async (targetPath: string) => {
      const currentChapters = useReaderStore.getState().chapters;
      const sorted = [...currentChapters].sort((a, b) =>
        a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
      );
      const target = sorted.find((ch) => ch.path === targetPath);
      if (!target) return;

      setChapter(target.path, target.title);
      try {
        const c = await fetchChapterContent(bookName, target.path);
        setBody(c.content);
        const main = document.querySelector("main");
        if (main) main.scrollTop = 0;
      } catch (e) {
        setPageError(e instanceof Error ? e.message : "Failed to load chapter");
      }
    },
    [bookName, setChapter, setBody, setPageError]
  );

  // ── Load skeleton TOC for strategy detection (re-fetch on regeneration) ──
  useEffect(() => {
    if (!bookName) return;
    fetchDynamicToc(bookName)
      .then((res) => setSkeletonToc(res?.toc_data ?? null))
      .catch(() => setSkeletonToc(null));
  }, [bookName, skeletonRefreshKey]);

  // ── Get strategy for a given chapter path (always fresh via ref, stable callback)
  const getChapterStrategy = useCallback((path: string): string => {
    const toc = skeletonTocRef.current;
    if (!toc) return "";
    const allChapters = [
      ...(toc.modules ?? []).flatMap((m: { chapters?: Array<{ file_path: string; strategy?: string }> }) => m.chapters ?? []),
      ...(toc.archived_chapters ?? []),
    ];
    if (allChapters.length === 0) return "";
    const normalize = (p: string) => {
      try { return decodeURIComponent(p).replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase(); }
      catch { return p.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase(); }
    };
    const target = normalize(path);
    const match = allChapters.find((ch: { file_path: string; strategy?: string }) => {
      const fp = normalize(ch.file_path ?? "");
      return fp === target || fp.endsWith("/" + target) || target.endsWith("/" + fp);
    });
    return match?.strategy?.trim() ?? "";
  }, []); // stable — reads skeletonTocRef.current on every invocation

  const handleChapterNavigate = useCallback(
    async (targetPath: string) => {
      const currentPath = useReaderStore.getState().currentChapterPath;
      const strategy = getChapterStrategy(currentPath ?? "");
      console.log("[handleChapterNavigate] strategy lookup:", { currentPath, strategy, hasSkeleton: !!skeletonTocRef.current });

      // Not gated — navigate directly if NOT (intensive mode + 精读 strategy)
      const currentMode = useReaderStore.getState().readingMode;
      const shouldGate = !!(skeletonTocRef.current && strategy === "精读" && currentMode !== "immersive");
      if (!shouldGate) {
        goToChapter(targetPath);
        return;
      }

      // ── Gate: current chapter is "精读" → QuizModal is the sole gatekeeper ──
      // All navigation now flows through: QuizModal.onPass → handleQuizPass → goToChapter(pending)
      setPendingChapter(targetPath);
      setQuizGenerating(true);
      try {
        const result = await fetchQuizQuestions(bookName, currentPath ?? "", currentChapterTitle ?? "");
        setQuizQuestions(result.questions ?? []);
        setQuizOpen(true);
      } catch (e) {
        console.error("Quiz generation failed:", e);
        setQuizQuestions([]);
        setQuizOpen(true);
      } finally {
        setQuizGenerating(false);
      }
      // Never call goToChapter here — the gate is locked until QuizModal fires onPass
    },
    [bookName, goToChapter, setPendingChapter, setQuizGenerating, setQuizQuestions, setQuizOpen, getChapterStrategy]
  );

  const handleQuizPass = useCallback(() => {
    setQuizOpen(false);
    const pending = useReaderStore.getState().pendingChapter;
    if (pending) {
      goToChapter(pending);
      setPendingChapter(null);
    }
  }, [goToChapter, setQuizOpen, setPendingChapter]);

  useEffect(() => {
    if (!bookName) return;
    initStore();
    setActiveBook(bookName);
    setPageLoading(true);

    Promise.all([fetchBookMeta(bookName), fetchChapters(bookName)])
      .then(([meta, chaps]) => {
        setBookMeta(meta);
        const sorted = [...chaps].sort((a, b) =>
          a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
        );
        setChapters(sorted);

        const currentPath = useReaderStore.getState().currentChapterPath;
        if (!currentPath && sorted.length > 0) {
          setChapter(sorted[0].path, sorted[0].title);
        }
      })
      .catch((e) => setPageError(e.message));
  }, [bookName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bookName || !currentChapterPath) {
      const currentChapters = useReaderStore.getState().chapters;
      const currentPath = useReaderStore.getState().currentChapterPath;
      if (currentChapters.length > 0 && !currentPath) {
        setChapter(currentChapters[0].path, currentChapters[0].title);
        return;
      }
      setPageLoading(false);
      return;
    }

    setPageLoading(true);
    setBody(null);
    fetchChapterContent(bookName, currentChapterPath)
      .then((c) => setBody(c.content))
      .catch((e) => setPageError(e.message))
      .finally(() => setPageLoading(false));
  }, [bookName, currentChapterPath]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (error && (error.includes("404") || error.includes("not found"))) {
      setNotFound(true);
    }
  }, [error]);

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-6 bg-white">
        <div className="text-neutral-400 text-6xl select-none">📖</div>
        <h1 className="text-xl font-medium text-neutral-600">这本书不存在或尚未导入</h1>
        <button
          onClick={() => router.push("/books")}
          className="px-6 py-2 text-sm rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 transition-colors"
        >
          返回书架
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-red-500 text-sm">{error}</p>
        <button
          onClick={() => router.push("/books")}
          className="px-4 py-1.5 text-xs rounded-md bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
        >
          返回书架
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <SelectionToolbar bookName={bookName} />

      <TopBar
        onToggleToc={() => useReaderStore.getState().toggleToc()}
        bookName={bookName}
      />

      <div className="flex flex-1 overflow-hidden">
        <TocDrawer
          bookName={bookName}
          isOpen={tocOpen}
          onClose={() => setTocOpen(false)}
          onOpenWizard={() => { setTocOpen(false); setWizardOpen(true); }}
          refreshKey={skeletonRefreshKey}
          isGeneratingSkeleton={isGeneratingSkeleton}
          onGenerateAnimation={handleGenerateAnimation}
        />

        <main className={`flex-1 overflow-y-auto ${readingMode === "immersive" ? "max-w-full" : ""} ${THEME_BG[theme]}`}>
          <InnerReaderHeader bookName={bookName} />
          <ReaderView
            bookName={bookName}
            title={currentChapterTitle}
            content={body}
            loading={loading}
          />

          {/* TeachAny 知识沙盘入口已迁移至 BottomNav */}

          {chapters.length > 0 && currentChapterPath && !loading && (
            <BottomNav
              bookName={bookName}
              chapters={chapters}
              currentPath={currentChapterPath}
              chapterContent={body ?? ""}
              chapterStrategy={getChapterStrategy(currentChapterPath)}
              skeletonToc={skeletonToc}
              quizGenerating={quizGenerating}
              onGenerateAnimation={handleGenerateAnimation}
              onNavigate={handleChapterNavigate}
            />
          )}
        </main>

        <ChatPanel bookName={bookName} />
      </div>

      <GraphModal bookName={bookName} />
      <ProfileWizardModal bookName={bookName} onProfileComplete={handleProfileComplete} />

      {quizOpen && (
        <QuizModal
          title={currentChapterTitle ?? "新章节"}
          questions={quizQuestions}
          skipped={quizQuestions.length === 0}
          skipReason="内容较少，已为您免检放行"
          onPass={handleQuizPass}
          onFail={(weakQuestions) => {
            setQuizOpen(false);
            const weakConcepts = weakQuestions.map(q => q.question.slice(0, 40)).join("、");
            const systemMsg = `⚠️ 检测到您对以下概念掌握尚有欠缺：${weakConcepts}。请针对这些薄弱点向 AI 导师提问，或在右侧 ChatPanel 中输入「帮我复习 [概念名]」来完成强化训练。完成自测后再次点击「下一章」重新挑战。`;
            chatStore.addMessage({
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: systemMsg,
            });
            if (!chatStore.isOpen) {
              chatStore.open();
            }
            setPendingChapter(null);
          }}
          onClose={() => {
            setQuizOpen(false);
            setPendingChapter(null);
          }}
        />
      )}

      <KnowledgeAnimationModal
        isOpen={isAnimationOpen}
        onClose={() => setIsAnimationOpen(false)}
        htmlContent={animationHtml}
        isLoading={isAnimationLoading}
      />
    </div>
  );
}
