"use client";

/** ReaderView — Markdown renderer with mark.js highlights for notes + search. */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Pencil, X, Trash2, StickyNote } from "lucide-react";
import { createPortal } from "react-dom";
import { useReaderStore, FONT_SIZES } from "@/lib/stores/readerStore";
import { useNoteStore } from "@/lib/stores/noteStore";
import type { NoteListItem } from "@/lib/types";
import Mark from "mark.js";

interface Props {
  bookName: string;
  content: string | null;
  title?: string | null;
  loading?: boolean;
}

type Theme = "day" | "warm" | "night";
const THEME_CLASSES: Record<Theme, string> = {
  day: "bg-[#F9F7F3] text-neutral-800",
  warm: "bg-[#f5f0e8] text-neutral-800",
  night: "bg-[#1a1a2e] text-neutral-200",
};

const THEME_ARTICLE_CLASSES: Record<Theme, string> = {
  day: "prose prose-neutral max-w-none reader-prose-override",
  warm: "prose prose-neutral max-w-none reader-prose-override",
  night: "prose-invert prose-neutral max-w-none reader-prose-override",
};

const HEADING_COLORS: Record<Theme, { h1: string; h2: string; p: string }> = {
  day:   { h1: "text-neutral-900", h2: "text-neutral-800", p: "text-neutral-700" },
  warm:  { h1: "text-neutral-900", h2: "text-neutral-800", p: "text-neutral-700" },
  night: { h1: "text-gray-200", h2: "text-gray-300", p: "text-gray-400" },
};

export default function ReaderView({ bookName, content }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const { fontSize, theme, highlightQuery, setHighlightQuery } = useReaderStore();

  const notes = useNoteStore((s) => s.notes);
  const noteVersion = useNoteStore((s) => s.version);
  const loadNotesAction = useNoteStore((s) => s.loadNotes);
  const updateNoteAction = useNoteStore((s) => s.saveNote);
  const removeNoteAction = useNoteStore((s) => s.removeNote);

  const themeClass = THEME_CLASSES[theme];
  const articleClass = THEME_ARTICLE_CLASSES[theme];

  // ── Local UI state (bubble, editing) ──
  const [selectedNote, setSelectedNote] = useState<NoteListItem | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [bubblePos, setBubblePos] = useState<{ x: number; y: number } | null>(null);

  // ── Load notes on mount / book change ──
  useEffect(() => {
    if (!bookName) return;
    loadNotesAction(bookName);
  }, [bookName, loadNotesAction]);

  // ── Pre-process markdown: clean heading prefixes + wikilinks ──
  const processedContent = useMemo(() => {
    if (!content) return "";
    let html = content;

    // Clean heading prefixes: "# 0000_标题" → "# 标题", "## 01_小节" → "## 小节"
    html = html.replace(/^(#{1,6})\s*\d+_(.*)$/gm, "$1 $2");

    // Wrap [[wikilinks]] as styled spans
    html = html.replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink">$1</span>');

    return html;
  }, [content]);

  // ── mark.js: highlight notes after DOM updates (noteVersion ensures reactivity) ──
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;

    const timer = setTimeout(() => {
      const instance = new Mark(article);
      // 🔑 Always unmark first — clears deleted notes instantly
      instance.unmark({ className: "note-highlight" });

      if (notes.length === 0) return; // nothing to mark

      for (const note of notes) {
        if (!note.quote) continue;
        instance.mark(note.quote, {
          className: "note-highlight",
          accuracy: "partially",
          acrossElements: true,
          each: (elem: HTMLElement) => {
            elem.setAttribute("data-note-id", note.note_id);
            elem.style.backgroundColor = "#fef08a";
            elem.style.textDecoration = "underline";
            elem.style.cursor = "pointer";
            elem.style.borderBottom = "2px solid #facc15";
            elem.style.borderRadius = "2px";
            elem.style.transition = "background-color 0.15s";
          },
        });
      }
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [processedContent, noteVersion, notes]);

  // ── mark.js: highlight search query ──
  useEffect(() => {
    const article = articleRef.current;
    if (!article || !highlightQuery) return;

    const timer = setTimeout(() => {
      const instance = new Mark(article);
      instance.unmark(); // clear previous search highlights
      instance.mark(highlightQuery, {
        className: "search-highlight",
        accuracy: "partially",
        acrossElements: true,
        each: (elem: HTMLElement) => {
          elem.style.backgroundColor = "#bfdbfe";
          elem.style.borderRadius = "2px";
          elem.setAttribute("data-search-highlight", "true");
        },
        done: () => {
          // Scroll to first match
          const first = article.querySelector("[data-search-highlight]");
          if (first) {
            first.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          // Auto-clear after 4s
          setTimeout(() => {
            const inner = new Mark(article);
            inner.unmark({ className: "search-highlight" });
            setHighlightQuery(null);
          }, 4000);
        },
      });
    }, 200);

    return () => clearTimeout(timer);
  }, [highlightQuery, setHighlightQuery, processedContent]);

  // ── Click handler: note highlight → floating bubble ──
  const handleArticleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const noteEl = target.closest("[data-note-id]") as HTMLElement | null;
      if (!noteEl) {
        setSelectedNote(null);
        setBubblePos(null);
        return;
      }
      const noteId = noteEl.getAttribute("data-note-id");
      if (!noteId) return;
      const note = notes.find((n) => n.note_id === noteId);
      if (note) {
        setSelectedNote(note);
        setEditingContent(note.content);
        const rect = noteEl.getBoundingClientRect();
        setBubblePos({ x: rect.left + rect.width / 2, y: rect.top - 8 });
      }
    },
    [notes]
  );

  // ── Update note (store-backed, triggers reactive re-mark) ──
  const handleUpdateNote = async () => {
    if (!selectedNote) return;
    setNoteSaving(true);
    try {
      await updateNoteAction(bookName, selectedNote.quote, editingContent);
      setSelectedNote(null);
      setBubblePos(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setNoteSaving(false);
    }
  };

  // ── Delete note (store-backed, immutable removal triggers re-mark) ──
  const handleDeleteNote = async () => {
    if (!selectedNote) return;
    setNoteSaving(true);
    try {
      await removeNoteAction(bookName, selectedNote.note_id);
      setSelectedNote(null);
      setBubblePos(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setNoteSaving(false);
    }
  };

  // ── Custom ReactMarkdown renderers ──
  const markdownComponents = useMemo(
    () => {
      const colors = HEADING_COLORS[theme];
      return {
        h1: ({ children, ...props }: any) => (
          <h1 className={`font-extrabold tracking-tight ${colors.h1} mt-10 mb-6 pb-4 leading-normal`} {...props}>
            {children}
          </h1>
        ),
        h2: ({ children, ...props }: any) => (
          <h2 className={`font-bold ${colors.h2} mt-8 mb-4 leading-relaxed`} {...props}>
            {children}
          </h2>
        ),
        p: ({ children, ...props }: any) => (
          <p className={`${colors.p} leading-loose mb-6`} {...props}>
            {children}
          </p>
        ),
      };
    },
    [theme]
  );

  return (
    <div
      id="reader-view"
      className={`relative min-h-full transition-colors duration-200 ${themeClass}`}
    >
      <style dangerouslySetInnerHTML={{
        __html: `
    .reader-prose-override p,
    .reader-prose-override li,
    .reader-prose-override blockquote,
    .reader-prose-override table {
      font-size: ${typeof fontSize === 'number' ? fontSize : parseInt(fontSize)}px !important;
      line-height: 1.8 !important;
      white-space: pre-line !important;
      margin-bottom: 1.5em !important;
    }
    .reader-prose-override h1 {
      font-size: 2.25rem !important;
      line-height: 1.3 !important;
      margin-bottom: 1.5rem !important;
    }
    .reader-prose-override h2 {
      font-size: 1.875rem !important;
      line-height: 1.4 !important;
      margin-top: 2.5rem !important;
      margin-bottom: 1rem !important;
    }
    .reader-prose-override h3 {
      font-size: 1.5rem !important;
      margin-top: 2rem !important;
      margin-bottom: 1rem !important;
    }
    .reader-prose-override h4 {
      font-size: 1.25rem !important;
    }
        `.trim()
      }} />
      <div
        ref={containerRef}
        className="reader-content mx-auto max-w-3xl px-8 py-12"
      >
        {!content ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-neutral-300" />
          </div>
        ) : (
          <article
            ref={articleRef}
            className={articleClass}
            onClick={handleArticleClick}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {processedContent}
            </ReactMarkdown>
          </article>
        )}
      </div>

      {/* ── Note highlight bubble — Portal floating near selection ── */}
      {selectedNote && bubblePos && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed z-[90]"
            style={{ left: bubblePos.x, top: bubblePos.y, transform: "translate(-50%, -100%)" }}
          >
            <div className="bg-white rounded-xl shadow-2xl border border-neutral-200 w-[340px] max-w-[90vw]">
              {/* Header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100">
                <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                  <StickyNote size={12} />
                  笔记
                </span>
                <button
                  onClick={() => { setSelectedNote(null); setBubblePos(null); }}
                  className="p-0.5 rounded hover:bg-neutral-100 text-neutral-400"
                >
                  <X size={12} />
                </button>
              </div>

              {/* Quote preview */}
              <div className="px-3 pt-2 text-xs text-neutral-400 italic line-clamp-2">
                &ldquo;{selectedNote.quote.slice(0, 100)}{selectedNote.quote.length > 100 ? "…" : ""}&rdquo;
              </div>

              {/* Editable content */}
              <div className="px-3 py-2">
                <textarea
                  value={editingContent}
                  onChange={(e) => setEditingContent(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-neutral-300"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between px-3 pb-3">
                <button
                  onClick={handleDeleteNote}
                  className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors"
                  disabled={noteSaving}
                >
                  <Trash2 size={12} />
                  删除
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setSelectedNote(null); setBubblePos(null); }}
                    className="px-3 py-1.5 text-xs rounded-md hover:bg-neutral-100 text-neutral-500"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleUpdateNote}
                    disabled={noteSaving}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-neutral-800 text-white hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    <Pencil size={12} />
                    {noteSaving ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </div>
            {/* Arrow pointing down to the highlight */}
            <div className="flex justify-center">
              <div className="w-3 h-3 bg-white border-r border-b border-neutral-200 rotate-45 -mt-[6px]" />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
