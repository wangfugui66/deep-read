"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Link, StickyNote, X, Loader } from "lucide-react";
import { streamChatAction } from "@/lib/api_client";
import { useNoteStore } from "@/lib/stores/noteStore";
import type { ChatActionType } from "@/lib/types";

// ====================================================================
// SelectionToolbar — Portal-based floating toolbar + popover
//
// Uses native document 'selectionchange' event (debounced) instead of
// React mouse events, avoiding conflicts with mark.js DOM mutations.
// ====================================================================

type PopoverMode = "explain" | "associate" | null;

interface Props {
  bookName: string;
}

export default function SelectionToolbar({ bookName }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [mounted, setMounted] = useState(false);

  // Note state
  const [noteContent, setNoteContent] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  // Popover state
  const [popoverMode, setPopoverMode] = useState<PopoverMode>(null);
  const [popoverText, setPopoverText] = useState("");
  const [popoverLoading, setPopoverLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setMounted(true); }, []);

  const getSelectedText = () => window.getSelection()?.toString()?.trim() ?? "";

  // ── Native selectionchange with debounce ──
  const handleSelectionChange = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString()?.trim();
      if (!text || !sel || sel.rangeCount === 0) {
        setVisible(false);
        return;
      }
      // Ensure selection is inside the reader view
      const container = document.getElementById("reader-view");
      if (container && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) {
          setVisible(false);
          return;
        }
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
      });
      setVisible(true);
    }, 200);
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleSelectionChange]);

  // Dismiss popover on outside click
  useEffect(() => {
    if (!popoverMode) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        dismissPopover();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popoverMode]);

  const runAction = async (action: ChatActionType) => {
    const text = getSelectedText();
    if (!text) return;

    setVisible(false);
    setPopoverMode(action);
    setPopoverText("");
    setPopoverLoading(true);

    // Position popover below selection
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.bottom + 8,
      });
    }

    try {
      for await (const chunk of streamChatAction(action, text, bookName)) {
        if (chunk.done) break;
        if (chunk.token) {
          setPopoverText((prev) => prev + chunk.token);
        }
      }
    } catch {
      setPopoverText((prev) => prev + " [请求失败，请检查 API Key]");
    } finally {
      setPopoverLoading(false);
    }
  };

  const dismissPopover = () => {
    setPopoverMode(null);
    setPopoverText("");
    setPopoverLoading(false);
  };

  if (!mounted) return null;

  return (
    <>
      {/* Toolbar — rendered to document.body via Portal */}
      {visible &&
        createPortal(
          <div
            className="flex items-center gap-0.5 bg-white rounded-lg shadow-lg border border-neutral-200 px-1 py-1"
            style={{
              position: "fixed",
              left: Math.max(8, position.x - 60),
              top: Math.max(8, position.y - 40),
              zIndex: 50,
              transform: "translateX(-50%)",
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <ToolbarButton icon={<Sparkles size={14} />} label="解释" onClick={() => runAction("explain")} />
            <ToolbarButton icon={<Link size={14} />} label="联想" onClick={() => runAction("associate")} />
            <ToolbarButton
              icon={<StickyNote size={14} />}
              label="笔记"
              onClick={() => {
                const text = getSelectedText();
                setNoteText(text);
                setNoteOpen(true);
                setVisible(false);
              }}
            />
            <div className="w-px h-4 bg-neutral-200 mx-0.5" />
            <ToolbarButton icon={<X size={14} />} label="" onClick={() => setVisible(false)} />
          </div>,
          document.body
        )}

      {/* Popover — Portal to document.body */}
      {popoverMode &&
        createPortal(
          <div
            ref={popoverRef}
            className="bg-white rounded-xl shadow-2xl border border-neutral-200 w-[340px] max-w-[90vw]"
            style={{
              position: "fixed",
              left: Math.min(position.x, window.innerWidth - 360),
              top: Math.min(position.y, window.innerHeight - 300),
              zIndex: 55,
            }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100">
              <span className="text-xs font-medium text-neutral-500 flex items-center gap-1.5">
                {popoverMode === "explain" ? (
                  <><Sparkles size={12} /> 解释</>
                ) : (
                  <><Link size={12} /> 联想</>
                )}
              </span>
              <button onClick={dismissPopover} className="p-0.5 rounded hover:bg-neutral-100 text-neutral-400">
                <X size={12} />
              </button>
            </div>
            <div className="px-3 py-2.5 text-sm leading-relaxed text-neutral-700 max-h-56 overflow-y-auto">
              {popoverLoading && !popoverText && (
                <div className="flex items-center gap-2 text-neutral-400">
                  <Loader size={14} className="animate-spin" />
                  DeepSeek 思考中…
                </div>
              )}
              {popoverText && <p className="whitespace-pre-wrap">{popoverText}</p>}
            </div>
          </div>,
          document.body
        )}

      {/* Note popover — Portal */}
      {noteOpen &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
            <div className="bg-white rounded-xl shadow-2xl w-[420px] max-w-[90vw] p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-neutral-700">笔记</h3>
                <button onClick={() => setNoteOpen(false)} className="p-1 rounded-md hover:bg-neutral-100">
                  <X size={14} />
                </button>
              </div>
              <blockquote className="text-sm text-neutral-500 border-l-2 border-neutral-300 pl-3 mb-3 italic">
                {noteText}
              </blockquote>
              <textarea
                autoFocus
                placeholder="写下你的想法…"
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full h-28 text-sm px-3 py-2 rounded-md border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300 resize-none"
              />
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => { setNoteOpen(false); setNoteContent(""); }}
                  className="px-3 py-1.5 text-xs rounded-md hover:bg-neutral-100 text-neutral-500"
                >
                  取消
                </button>
                <button
                  onClick={async () => {
                    if (!noteContent.trim()) return;
                    setNoteSaving(true);
                    try {
                      await useNoteStore.getState().saveNote(bookName, noteText, noteContent);
                    } catch (e) {
                      console.error("Save note failed:", e);
                    } finally {
                      setNoteSaving(false);
                      setNoteOpen(false);
                      setNoteContent("");
                    }
                  }}
                  disabled={noteSaving}
                  className="px-3 py-1.5 text-xs rounded-md bg-neutral-800 text-white disabled:opacity-50"
                >
                  {noteSaving ? "保存中…" : "保存笔记"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-600 rounded hover:bg-neutral-100 transition-colors whitespace-nowrap"
      title={label}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
