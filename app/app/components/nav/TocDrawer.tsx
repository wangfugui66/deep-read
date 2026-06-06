"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X, ChevronLeft, ChevronRight, ChevronDown, Loader2, Sparkles, BookOpen, Stethoscope, Layers,
} from "lucide-react";
import { fetchChapters, fetchDynamicToc, fetchIndexingStatus, generateSkeleton, deleteProfile } from "@/lib/api_client";
import { useReaderStore } from "@/lib/stores/readerStore";
import type { ChapterRef, SkeletonTocData } from "@/lib/types";
import { API_BASE_URL, resolveTeachAnyUrl } from "@/lib/api-config";

// ====================================================================
// TocDrawer — unified TOC with strategy overlay from dynamic skeleton
// ====================================================================

interface TocNode {
  path: string;
  displayTitle: string;
  level: number;
  children: TocNode[];
}

interface StrategyInfo {
  strategy: string;
  advice?: string;
}

interface Props {
  bookName: string;
  isOpen: boolean;
  onClose: () => void;
  onOpenWizard?: () => void;
  refreshKey?: number;
  isGeneratingSkeleton?: boolean;
}

function cleanChapterTitle(title: string): string {
  return title.replace(/^\d+_/, "").replace(/\.md$/, "");
}

function parseChapter(ch: ChapterRef): { displayTitle: string; level: number; orderNum: string } {
  const title = cleanChapterTitle(ch.title);
  const numMatch = title.match(/^([\d.]+)/);
  if (numMatch) {
    const parts = numMatch[1].split(".").filter(Boolean);
    return { displayTitle: title, level: parts.length, orderNum: numMatch[1] };
  }
  if (/^第[一二三四五六七八九十百]+[章篇部]/.test(title)) return { displayTitle: title, level: 1, orderNum: "" };
  if (/^[一二三四五六七八九十]+[、,]/.test(title)) return { displayTitle: title, level: 2, orderNum: "" };
  return { displayTitle: title, level: 1, orderNum: "" };
}

function buildTree(chapters: ChapterRef[]): TocNode[] {
  const parsed = chapters.map((ch) => ({ ...parseChapter(ch), path: ch.path }));
  const maxLevel = Math.max(...parsed.map((p) => p.level));
  if (maxLevel <= 1) {
    return parsed.map((p) => ({ path: p.path, displayTitle: p.displayTitle, level: 1, children: [] }));
  }
  const roots: TocNode[] = [];
  const stack: { node: TocNode; level: number }[] = [];
  for (const p of parsed) {
    const node: TocNode = { path: p.path, displayTitle: p.displayTitle, level: p.level, children: [] };
    if (p.level === 1) {
      roots.push(node);
      stack.length = 0;
      stack.push({ node, level: 1 });
    } else {
      while (stack.length > 0 && stack[stack.length - 1].level >= p.level) stack.pop();
      if (stack.length > 0) stack[stack.length - 1].node.children.push(node);
      else roots.push(node);
      stack.push({ node, level: p.level });
    }
  }
  return roots;
}

const INDENT_PX: Record<number, string> = { 1: "ml-0", 2: "ml-4", 3: "ml-8", 4: "ml-12", 5: "ml-16" };

// ── Strategy helpers ──

// ── Path normalizer (same logic as BottomNav for consistency) ──
function normalizePath(p: string): string {
  try { return decodeURIComponent(p).replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase(); }
  catch { return p.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase(); }
}

export default function TocDrawer({ bookName, isOpen, onClose, onOpenWizard, refreshKey, isGeneratingSkeleton }: Props) {
  // ── Original TOC state ──
  const [chapters, setChapters] = useState<ChapterRef[]>([]);
  const [loadingChapters, setLoadingChapters] = useState(true);
  const [chaptersError, setChaptersError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // ── Skeleton state ──
  const [tocData, setTocData] = useState<SkeletonTocData | null>(null);
  const [skeletonLoading, setSkeletonLoading] = useState(false);
  const [skeletonGenerating, setSkeletonGenerating] = useState(false);
  const [skeletonError, setSkeletonError] = useState<string | null>(null);
  const [aggregateToast, setAggregateToast] = useState<string | null>(null);
  const [aggregatingPath, setAggregatingPath] = useState<string | null>(null);

  const { currentChapterPath, setChapter, setWizardOpen, indexingStatus, setIndexingStatus, indexedCount, totalCount, setIndexingProgress, readingMode } = useReaderStore();

  const isImmersive = readingMode === "immersive";

  // ── Build strategy lookup map from skeleton ──
  const strategyMap = useMemo<Map<string, StrategyInfo>>(() => {
    const map = new Map<string, StrategyInfo>();
    if (!tocData) return map;
    for (const mod of tocData.modules ?? []) {
      for (const ch of mod.chapters ?? []) {
        if (ch.file_path) {
          const s = (ch.strategy ?? "").trim();
          map.set(normalizePath(ch.file_path), { strategy: s === "跳过" ? "略读" : s, advice: ch.advice });
        }
      }
    }
    for (const ch of tocData.archived_chapters ?? []) {
      if (ch.file_path) {
        const s = (ch.strategy ?? "").trim();
        map.set(normalizePath(ch.file_path), { strategy: s === "跳过" ? "略读" : s, advice: ch.advice });
      }
    }
    return map;
  }, [tocData]);

  // ── Load original TOC ──
  useEffect(() => {
    if (!bookName) return;
    setLoadingChapters(true);
    setChaptersError(null);
    fetchChapters(bookName)
      .then((chaps) => {
        const sorted = [...chaps].sort((a, b) =>
          a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
        );
        setChapters(sorted);
      })
      .catch((e) => setChaptersError(e.message))
      .finally(() => setLoadingChapters(false));
  }, [bookName]);

  // ── Load skeleton on mount and on refreshKey change (404 → null, no throw) ──
  useEffect(() => {
    if (!bookName) return;
    setSkeletonLoading(true);
    setSkeletonError(null);
    fetchDynamicToc(bookName)
      .then((res) => setTocData(res?.toc_data ?? null))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        setSkeletonError(msg);
      })
      .finally(() => setSkeletonLoading(false));
  }, [bookName, refreshKey]);

  // ── One-shot initial fetch: restore indexing status after page refresh ──
  useEffect(() => {
    if (!bookName) return;
    console.log("🔧 [INIT] 初次加载，单次拉取索引状态以恢复 UI…");
    fetchIndexingStatus(bookName)
      .then((s) => {
        console.log("📊 [INIT] 初始状态: status=%s, indexed=%d/%d", s.status, s.indexed, s.total);
        setIndexingStatus(s.status ?? "pending");
        setIndexingProgress(s.indexed ?? 0, s.total ?? 0);
      })
      .catch((err) => console.warn("⚠️ [INIT] 获取状态失败:", err));
  }, [bookName, setIndexingStatus, setIndexingProgress]);

  // ── Polling loop — only active when indexingStatus === "processing" ──
  useEffect(() => {
    if (!bookName) return;
    if (indexingStatus !== "processing") {
      console.log("🔧 [POLL] 跳过启动: indexingStatus=%s (非 'processing')", indexingStatus);
      return;
    }
    console.log("🔄 [3] 轮询已启动 (2s, 依赖 indexingStatus=%s)…", indexingStatus);
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const s = await fetchIndexingStatus(bookName);
        console.log("📊 [4] 轮询结果: status=%s, indexed=%d/%d", s.status, s.indexed, s.total);
        const newStatus = s.status ?? "pending";
        if (indexingStatus === "processing" && newStatus === "pending") {
          console.warn("⚠️ 拦截到后端异常的 pending 状态，拒绝降级，继续轮询...");
          return;
        }
        setIndexingStatus(newStatus);
        setIndexingProgress(s.indexed ?? 0, s.total ?? 0);
        if (newStatus === "completed") {
          console.log("🏁 [4a] status=completed → 清除定时器");
          if (timer) { clearInterval(timer); timer = null; }
        }
      } catch (err) {
        console.error("❌ [4] 轮询报错:", err instanceof Error ? err.message : String(err));
      }
    };

    timer = setInterval(poll, 2000);

    return () => {
      console.log("🔧 [POLL] 清理: 清除定时器 (indexingStatus=%s)", indexingStatus);
      if (timer) clearInterval(timer);
    };
  }, [indexingStatus, bookName, setIndexingStatus, setIndexingProgress]);

  const tree = useMemo(() => buildTree(chapters), [chapters]);

  // ── Compute read-paths set: chapters before current in sorted order ──
  const readPaths = useMemo<Set<string>>(() => {
    const set = new Set<string>();
    if (!currentChapterPath) return set;
    const sorted = [...chapters].sort((a, b) =>
      a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" })
    );
    const curIdx = sorted.findIndex((ch) => ch.path === currentChapterPath);
    if (curIdx <= 0) return set;
    for (let i = 0; i < curIdx; i++) {
      set.add(sorted[i].path);
    }
    return set;
  }, [chapters, currentChapterPath]);

  const handleSelect = useCallback(
    (ch: ChapterRef) => {
      setChapter(ch.path, ch.title);
      onClose();
    },
    [setChapter, onClose]
  );

  const toggleCollapse = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleGenerateSkeleton = async () => {
    if (isIndexing) return;
    setSkeletonGenerating(true);
    setSkeletonError(null);
    try {
      const result = await generateSkeleton(bookName);
      setTocData(result.toc_data ?? null);
    } catch (err) {
      setSkeletonError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setSkeletonGenerating(false);
    }
  };

  const hasSkeleton = !!tocData;
  const isIndexing = indexingStatus === "processing";

  const handleReDiagnose = async () => {
    if (isIndexing) return;
    if (!window.confirm("确定要重新进行诊疗吗？这会清除当前的定制骨架。")) return;
    try {
      await deleteProfile(bookName);
    } catch {
      // Ignore 404 (profile may not exist yet)
    }
    setTocData(null);
    setSkeletonError(null);
    onClose?.();
    if (onOpenWizard) onOpenWizard();
    else setWizardOpen?.(true);
  };

  const handleBuildIndex = async () => {
    if (isIndexing) {
      console.warn("⚠️ [BUILD-INDEX] 按钮点击被忽略: 已在 indexing 状态");
      return;
    }
    console.log("👉 [1] 按钮被点击，准备发送 POST 请求... bookName=%s", bookName);
    const apiKey = typeof window !== "undefined" ? localStorage.getItem("dr-api-key") ?? "" : "";
    console.log("   [1a] apiKey 长度=%d, 是否为空=%s", apiKey.length, !apiKey);
    try {
      const url = `http://localhost:8000/api/books/${encodeURIComponent(bookName)}/build_index`;
      console.log("   [1b] POST %s", url);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("❌ [2] POST 请求失败: HTTP %d — %s", res.status, text.slice(0, 200));
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json().catch(() => ({}));
      console.log("✅ [2] POST 请求成功！后端返回:", JSON.stringify(data));
      console.log("   [2a] 即将设置 indexingStatus='processing', indexedCount=0, totalCount=0");
      setIndexingStatus("processing");
      setIndexingProgress(0, 0);
      console.log("   [2b] setIndexingStatus + setIndexingProgress 已调用。2s 内轮询应启动…");
      alert("已通知后台开始构建，请稍候…");
    } catch (err) {
      console.error("❌ [2] POST 请求失败:", err instanceof Error ? err.message : String(err));
      alert("索引构建请求失败，请确认后端已启动");
    }
  };

  // ── Recursive path collector ──
  const collectAllPaths = (node: TocNode): string[] => {
    const paths: string[] = [node.path];
    for (const child of node.children) {
      paths.push(...collectAllPaths(child));
    }
    return paths;
  };

  // ── TeachAny aggregation handler — for native tree parent nodes ──
  const handleAggregateNode = async (node: TocNode) => {
    const chapterPaths = collectAllPaths(node).filter((p) => p && p.trim() !== "");
    if (chapterPaths.length === 0) {
      setAggregateToast("该章节下暂无有效正文内容");
      setTimeout(() => setAggregateToast(null), 3000);
      return;
    }

    setAggregatingPath(node.path);
    setAggregateToast(`AI 正在聚合「${node.displayTitle}」(${chapterPaths.length}节) 生成知识沙盘，约需 30 秒…`);

    try {
      const apiKey = typeof window !== "undefined" ? localStorage.getItem("dr-api-key") ?? "" : "";
      const res = await fetch(`${API_BASE_URL}/api/plugins/teachany/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          book_name: bookName,
          chapter_paths: chapterPaths,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data?.view_url) {
        setAggregateToast("知识沙盘生成成功！正在新标签页打开…");
        setTimeout(() => setAggregateToast(null), 2000);
        window.open(resolveTeachAnyUrl(data.view_url), "_blank");
      } else {
        throw new Error("后端未返回知识沙盘 URL");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      setAggregateToast(`生成失败: ${msg}`);
      setTimeout(() => setAggregateToast(null), 5000);
    } finally {
      setAggregatingPath(null);
    }
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={onClose} />}

      <aside
        className={`fixed top-0 left-0 h-full w-72 bg-white border-r border-neutral-200 z-50 transform transition-transform duration-200 ease-in-out shadow-xl md:shadow-none ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        } md:static md:translate-x-0 md:z-auto`}
      >
        {/* ── Header (single bar, no tabs) ── */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200">
          <span className="text-xs font-semibold text-neutral-700 flex items-center gap-1.5">
            <Sparkles size={12} className="text-amber-400" />
            目录导航
          </span>
          <div className="flex items-center gap-1">
            {/* ── Build-index button: visible when NOT completed ──
                 pending → prominent amber CTA; processing → disabled with progress ── */}
            {indexingStatus !== "completed" && (
              <button
                onClick={handleBuildIndex}
                disabled={indexingStatus === "processing"}
                className={`text-[10px] px-2 py-1 rounded-md inline-flex items-center gap-1 transition-colors ${
                  indexingStatus === "processing"
                    ? "bg-amber-50 text-amber-500 cursor-not-allowed"
                    : "bg-amber-500 text-white hover:bg-amber-600"
                }`}
                title={indexingStatus === "processing" ? "知识索引构建中…" : "启动后台知识索引构建"}
              >
                {indexingStatus === "processing" ? (
                  <>
                    <Loader2 size={10} className="animate-spin" />
                    索引构建中… {indexedCount}/{totalCount}
                  </>
                ) : (
                  "🚀 构建知识索引"
                )}
              </button>
            )}

            {/* ── Skeleton buttons: ONLY visible when completed ── */}
            {indexingStatus === "completed" && (
              <>
                {!hasSkeleton && !isGeneratingSkeleton && !skeletonGenerating && onOpenWizard && (
                  <button
                    onClick={onOpenWizard}
                    className="text-[10px] px-2 py-1 rounded-md bg-neutral-800 text-white hover:bg-neutral-700 transition-colors"
                    title="建立学习档案后自动生成"
                  >
                    开启 AI 精读
                  </button>
                )}
                {!hasSkeleton && !isGeneratingSkeleton && !skeletonGenerating && !onOpenWizard && (
                  <button
                    onClick={handleGenerateSkeleton}
                    disabled={skeletonGenerating || (isGeneratingSkeleton ?? false)}
                    className="text-[10px] px-2 py-1 rounded-md bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors disabled:opacity-50"
                  >
                    {skeletonGenerating || (isGeneratingSkeleton ?? false) ? "生成中…" : "生成骨架"}
                  </button>
                )}
                {hasSkeleton && (
                  <button
                    onClick={handleGenerateSkeleton}
                    disabled={skeletonGenerating || (isGeneratingSkeleton ?? false)}
                    className="text-[10px] px-2 py-1 rounded-md bg-neutral-100 text-neutral-400 hover:text-neutral-600 hover:bg-neutral-200 transition-colors disabled:opacity-50"
                    title="重新生成定制骨架"
                  >
                    {skeletonGenerating || (isGeneratingSkeleton ?? false) ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      "刷新骨架"
                    )}
                  </button>
                )}
                {hasSkeleton && onOpenWizard && (
                  <button
                    onClick={handleReDiagnose}
                    className="text-[10px] px-2 py-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors inline-flex items-center gap-1"
                    title="重新进行画像诊疗"
                  >
                    <Stethoscope size={11} />
                    重新诊疗
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-600 md:hidden">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Skeleton generating banner ── */}
        {(isGeneratingSkeleton || skeletonGenerating) && (
          <div className="px-4 py-3 text-center border-b border-neutral-100 animate-pulse">
            <Loader2 size={18} className="animate-spin text-amber-400 mx-auto mb-1" />
            <p className="text-xs text-neutral-500">
              {isGeneratingSkeleton ? "正在为您量身重组知识骨架…" : "AI 正在定制阅读路径…"}
            </p>
          </div>
        )}

        {/* ── AI indexing in progress banner ── */}
        {isIndexing && !(isGeneratingSkeleton || skeletonGenerating) && (
          <div className="px-4 py-2.5 text-center border-b border-amber-100 bg-amber-50/50">
            <p className="text-xs text-amber-700 flex items-center justify-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              {totalCount > 0
                ? `✨ 知识索引构建中... (${indexedCount}/${totalCount})`
                : "✨ 知识索引构建中..."}
            </p>
          </div>
        )}

        {/* ── AI indexing failed banner ── */}
        {indexingStatus === "failed" && !(isGeneratingSkeleton || skeletonGenerating) && (
          <div className="px-4 py-2.5 text-center border-b border-red-100 bg-red-50/50">
            <p className="text-xs text-red-600 flex items-center justify-center gap-1.5">
              ⚠️ 知识索引失败 — 请检查 API Key 是否有效
            </p>
          </div>
        )}

        {/* ── Skeleton loading banner ── */}
        {skeletonLoading && !isGeneratingSkeleton && !skeletonGenerating && (
          <div className="px-4 py-2 text-center border-b border-neutral-100">
            <Loader2 size={14} className="animate-spin text-neutral-300 mx-auto" />
          </div>
        )}

        {/* ── Skeleton error ── */}
        {skeletonError && !isGeneratingSkeleton && !skeletonGenerating && (
          <div className="px-4 py-2 text-center border-b border-red-100">
            <p className="text-[10px] text-red-400">{skeletonError}</p>
            <button
              onClick={handleGenerateSkeleton}
              className="text-[10px] underline text-red-400 hover:text-red-600 mt-0.5"
            >
              重试
            </button>
          </div>
        )}

        <nav className="overflow-y-auto h-[calc(100vh-3rem)] py-2">
          {/* ── TeachAny aggregation toast (sticky — always visible) ── */}
          {aggregateToast && (
            <div className="sticky bottom-2 z-10 mx-2 px-2.5 py-1.5 rounded bg-indigo-50 border border-indigo-100 text-[10px] text-indigo-600 shadow">
              {aggregateToast}
            </div>
          )}
          {loadingChapters && (
            <div className="px-4 py-8 text-sm text-neutral-400 text-center animate-pulse">加载中…</div>
          )}
          {chaptersError && (
            <div className="px-4 py-8 text-sm text-red-500 text-center">{chaptersError}</div>
          )}
          {!loadingChapters && !chaptersError && chapters.length === 0 && (
            <div className="px-4 py-8 text-sm text-neutral-400 text-center">暂无章节</div>
          )}
          {!loadingChapters && !chaptersError && chapters.length > 0 && (
            <TreeNodeList
              nodes={tree}
              currentPath={currentChapterPath}
              collapsed={collapsed}
              indentMap={INDENT_PX}
              onSelect={handleSelect}
              onToggleCollapse={toggleCollapse}
              chapters={chapters}
              strategyMap={strategyMap}
              readPaths={readPaths}
              isImmersive={isImmersive}
              onAggregateNode={handleAggregateNode}
              aggregatingPath={aggregatingPath}
            />
          )}
        </nav>
      </aside>
    </>
  );
}

// ====================================================================
// Recursive tree renderer — with strategy overlay
// ====================================================================

function TreeNodeList({
  nodes, currentPath, collapsed, indentMap, onSelect, onToggleCollapse, chapters, strategyMap, readPaths, isImmersive, onAggregateNode, aggregatingPath,
}: {
  nodes: TocNode[];
  currentPath: string | null;
  collapsed: Set<string>;
  indentMap: Record<number, string>;
  onSelect: (ch: ChapterRef) => void;
  onToggleCollapse: (path: string) => void;
  chapters: ChapterRef[];
  strategyMap: Map<string, StrategyInfo>;
  readPaths: Set<string>;
  isImmersive: boolean;
  onAggregateNode: (node: TocNode) => void;
  aggregatingPath: string | null;
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(node.path);
        const isActive = node.path === currentPath;
        const indent = indentMap[node.level] ?? "";

        // Strategy overlay
        const si = strategyMap.get(normalizePath(node.path));
        const rawStrategy = si?.strategy ?? "";
        const strategy = rawStrategy;
        const isIntensive = strategy === "精读";

        // Read-state: chapters before current → gray
        const isRead = readPaths.has(node.path);

        // Build dynamic className
        let itemClass = `w-full text-left px-4 py-1.5 text-sm transition-colors flex items-center justify-between gap-1 ${indent} `;
        if (isActive) {
          itemClass += "bg-neutral-100 text-neutral-900 font-medium";
        } else if (isRead) {
          itemClass += "text-gray-400 hover:bg-neutral-50";
        } else {
          itemClass += "text-neutral-700 hover:bg-neutral-50";
        }

        return (
          <div key={node.path}>
            <button
              onClick={() => {
                const ch = chapters.find((c) => c.path === node.path);
                if (ch) onSelect(ch);
              }}
              className={itemClass}
            >
              {/* Collapse toggle + title */}
              <span className="flex items-center gap-1 min-w-0 flex-1">
                {hasChildren ? (
                  <span
                    onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.path); }}
                    className="shrink-0 p-0.5 rounded hover:bg-neutral-200 text-neutral-400"
                  >
                    {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </span>
                ) : (
                  <span className="w-4 shrink-0" />
                )}

                <span className={`truncate ${!isImmersive && isIntensive && !isRead ? "font-bold" : ""}`}>
                  {node.displayTitle}
                </span>
              </span>

              {/* Aggregation button — parent nodes only, hidden in immersive */}
              {!isImmersive && hasChildren && (
                <span
                  onClick={(e) => { e.stopPropagation(); onAggregateNode(node); }}
                  className="shrink-0 p-0.5 rounded text-neutral-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                  title={aggregatingPath === node.path
                    ? "知识沙盘生成中…"
                    : `聚合「${node.displayTitle}」及子章节`}
                >
                  {aggregatingPath === node.path ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Layers size={11} />
                  )}
                </span>
              )}

              {/* Strategy badge — only 精读 gets visual emphasis, hidden in immersive mode */}
              {!isImmersive && isIntensive && !isRead && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 bg-red-50 border-red-200 text-red-600">
                  <BookOpen size={10} />
                  精读
                </span>
              )}
            </button>

            {hasChildren && !isCollapsed && (
              <TreeNodeList
                nodes={node.children}
                currentPath={currentPath}
                collapsed={collapsed}
                indentMap={indentMap}
                onSelect={onSelect}
                onToggleCollapse={onToggleCollapse}
                chapters={chapters}
                strategyMap={strategyMap}
                readPaths={readPaths}
                isImmersive={isImmersive}
                onAggregateNode={onAggregateNode}
                aggregatingPath={aggregatingPath}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
