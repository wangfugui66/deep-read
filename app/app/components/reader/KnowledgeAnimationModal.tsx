"use client";

/** KnowledgeAnimationModal — Immersive full-screen modal for HyperFrames "知识动画".
 *
 *  Architecture:
 *  - @hyperframes/player only accepts a URL via the `src` attribute, not raw HTML.
 *    We bridge this by creating a Blob → Object URL from the HTML string.
 *  - The custom element is registered via a client-side dynamic import (useEffect),
 *    keeping the component tree SSR-safe (no "window is not defined" crashes).
 *  - Instead of JSX <hyperframes-player> (which triggers TS JSX.IntrinsicElements
 *    type-checking issues), we create the element imperatively via
 *    document.createElement('hyperframes-player') and append to a container div.
 *    This guarantees zero TS errors and avoids namespace merging complexity.
 *  - Cleanup: Blob URLs are revoked when the modal closes or content changes.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Loader2 } from "lucide-react";

// ── Props ──────────────────────────────────────────────────────────────────

interface KnowledgeAnimationModalProps {
  isOpen: boolean;
  onClose: () => void;
  htmlContent: string | null;
  isLoading: boolean;
}

// ── Geek-style loading skeleton (zero external deps: only Tailwind + inline keyframes) ──

function LoadingOverlay() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 h-full">
      {/* Animated code window */}
      <div className="w-72 rounded-xl border border-neutral-700 bg-neutral-900/90 overflow-hidden shadow-lg">
        {/* Title bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-700">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="ml-2 text-[10px] text-neutral-500 font-mono">storyboard.js</span>
        </div>
        {/* Code body */}
        <div className="px-3 py-3 space-y-1.5 font-mono text-[11px] leading-relaxed">
          <TypewriterLine text="const timeline = gsap.timeline();" delay={0} />
          <TypewriterLine text="timeline.fromTo('.hero'," delay={400} />
          <TypewriterLine text="  { opacity: 0, scale: 0.8 }," delay={800} />
          <TypewriterLine text="  { opacity: 1, scale: 1, duration: 1.2 }" delay={1200} />
          <TypewriterLine text=");" delay={1600} />
          {/* Cursor */}
          <div className="flex items-center gap-0.5">
            <span className="inline-block w-1.5 h-4 bg-amber-400 animate-pulse rounded-sm" />
            <span className="text-neutral-600 text-[10px]">composing...</span>
          </div>
        </div>
      </div>

      {/* Status text */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <Loader2 size={16} className="animate-spin text-amber-400" />
          <span className="text-sm text-neutral-300 font-medium">
            DeepSeek 正在构思分镜与生成动画...
          </span>
        </div>
        <p className="text-xs text-neutral-500 max-w-xs text-center">
          正在解析知识点关联图谱，编排视觉叙事序列
        </p>
      </div>
    </div>
  );
}

/** Line-by-line typewriter effect — pure CSS animation, no JS timers. */

function TypewriterLine({ text, delay }: { text: string; delay: number }) {
  return (
    <div className="overflow-hidden whitespace-nowrap" style={{ maxWidth: `${text.length}ch` }}>
      <span
        className="text-green-400 inline-block"
        style={{
          animation: `typewriter-reveal 0.3s steps(${text.length}) ${delay}ms both`,
        }}
      >
        {text}
      </span>
    </div>
  );
}

// ── Inline global keyframes (injected once, survives React re-renders) ──

let keyframesInjected = false;

function injectKeyframes() {
  if (keyframesInjected || typeof document === "undefined") return;
  keyframesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes typewriter-reveal {
      from { width: 0; }
      to   { width: 100%; }
    }
  `;
  document.head.appendChild(style);
}

// ── Main component ─────────────────────────────────────────────────────────

export default function KnowledgeAnimationModal({
  isOpen,
  onClose,
  htmlContent,
  isLoading,
}: KnowledgeAnimationModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerElRef = useRef<HTMLElement | null>(null);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  // ── Register custom element on mount ──
  useEffect(() => {
    let cancelled = false;
    import("@hyperframes/player").then(() => {
      if (!cancelled) {
        injectKeyframes();
        setPlayerReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Blob URL — useState + useEffect (safe lifecycle, no memory leak) ──
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!htmlContent) {
      setBlobUrl(null);
      return;
    }
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [htmlContent]);

  // ── Imperative player element creation — bypasses JSX.IntrinsicElements TS check ──
  const mountPlayer = useCallback(() => {
    const container = containerRef.current;
    if (!container || !blobUrl || !playerReady) return;

    // Remove previous player if any
    if (playerElRef.current) {
      playerElRef.current.remove();
      playerElRef.current = null;
    }

    const player = document.createElement("hyperframes-player");
    player.setAttribute("src", blobUrl);
    player.setAttribute("controls", "");
    player.setAttribute("autoplay", "");
    player.setAttribute("loop", "");
    player.classList.add("w-full", "h-full", "block", "rounded-b-2xl", "overflow-hidden");
    container.appendChild(player);
    playerElRef.current = player;

    const onError = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      setPlayerError(detail?.message || "Failed to load composition");
    };
    player.addEventListener("error", onError);
    return () => player.removeEventListener("error", onError);
  }, [blobUrl, playerReady]);

  useEffect(() => {
    const cleanup = mountPlayer();
    return () => {
      cleanup?.();
      if (playerElRef.current) {
        playerElRef.current.remove();
        playerElRef.current = null;
      }
    };
  }, [mountPlayer]);

  // ── Keyboard: Escape to close ──
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ── Reset error when content changes ──
  useEffect(() => {
    setPlayerError(null);
  }, [htmlContent]);

  // ── Guard: SSR ──
  if (typeof document === "undefined" || !isOpen) return null;

  const showPlayer = playerReady && !isLoading && blobUrl && !playerError;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* ── Modal container ── */}
      <div
        className="relative w-[85vw] max-w-5xl aspect-video bg-neutral-950 rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-neutral-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Top bar ── */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800 shrink-0 bg-neutral-900/50">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-semibold text-neutral-300 tracking-wide">
              FluxRead · 知识动画
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-neutral-800 text-neutral-500 hover:text-neutral-200 transition-colors"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 relative bg-black">
          {/* Loading state */}
          {isLoading && <LoadingOverlay />}

          {/* Error state */}
          {playerError && !isLoading && (
            <div className="flex flex-col items-center justify-center gap-3 h-full">
              <span className="text-4xl">⚠️</span>
              <p className="text-sm text-red-400">{playerError}</p>
              <button
                onClick={() => setPlayerError(null)}
                className="px-4 py-1.5 text-xs rounded-md bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors"
              >
                重试
              </button>
            </div>
          )}

          {/* Player container (imperatively populated, avoids JSX type-check) */}
          {showPlayer && <div ref={containerRef} className="w-full h-full" />}

          {/* Empty state: player ready but no content yet */}
          {playerReady && !isLoading && !blobUrl && !playerError && (
            <div className="flex flex-col items-center justify-center gap-3 h-full">
              <span className="text-4xl opacity-40">🎬</span>
              <p className="text-sm text-neutral-500">尚未生成动画内容</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
