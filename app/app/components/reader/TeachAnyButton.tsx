"use client";

import { useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";
import { API_BASE_URL, resolveTeachAnyUrl } from "@/lib/api-config";

interface Props {
  bookName: string;
  /** Relative chapter path (e.g. "0001_目录.md") — sent to backend for generation. */
  chapterPath: string;
  /** Current chapter text content — used to estimate word count for gatekeeper. */
  chapterContent: string;
  /** Strategy from skeleton TOC (if available), e.g. "精读" / "速读" / "选读" / "跳过". */
  chapterStrategy?: string;
}

/**
 * TeachAny 知识沙盘生成入口按钮（单节粒度）。
 *
 * Gatekeeper (反幻觉守门员):
 * - 字数 < 1000 → disabled（内容过少无法提炼有效知识沙盘）
 *
 * 可用时发送 POST 请求到后端，拿到 URL 后 window.open 在新标签页打开。
 */
export default function TeachAnyButton({ bookName, chapterPath, chapterContent, chapterStrategy }: Props) {
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // ── Safe navigation: avoid TypeError on missing data ──
  const wordCount = chapterContent?.length || 0;
  const strategy = chapterStrategy?.trim() || "";

  // ── Gatekeeper conditions ──
  const tooShort = wordCount < 1000;
  const disabled = tooShort || loading;

  // ── Tooltip text ──
  let tooltip: string;
  if (tooShort) {
    tooltip = "本节内容较少（不足1000字），为防止 AI 幻觉，请在左侧目录点击【章】层级的按钮生成聚合知识沙盘";
  } else if (loading) {
    tooltip = "AI 正在为您设计教案，约需 30 秒…";
  } else {
    tooltip = "提炼为知识沙盘";
  }

  const showToast = (msg: string, durationMs = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), durationMs);
  };

  const handleClick = async () => {
    if (loading || disabled) return;
    setLoading(true);
    showToast("AI 正在为您设计教案，约需 30 秒…");

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
          chapter_paths: [chapterPath],
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data?.view_url) {
        showToast("知识沙盘生成成功！正在新标签页打开…", 2000);
        window.open(resolveTeachAnyUrl(data.view_url), "_blank");
      } else {
        throw new Error("后端未返回知识沙盘 URL");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      showToast(`生成失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={disabled}
        title={tooltip}
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs rounded-md transition-all ${
          disabled
            ? "bg-neutral-100 text-neutral-350 cursor-not-allowed opacity-60"
            : "bg-indigo-50 border border-indigo-200 text-indigo-600 hover:bg-indigo-100 active:scale-95"
        }`}
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <GraduationCap size={14} />
        )}
        <span>{loading ? "生成中…" : "知识沙盘"}</span>
      </button>

      {/* Toast */}
      {toast && (
        <span className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-neutral-800 text-white text-[10px] px-2.5 py-1 rounded-md shadow animate-pulse z-10">
          {toast}
        </span>
      )}
    </div>
  );
}
