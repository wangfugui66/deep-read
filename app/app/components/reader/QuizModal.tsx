"use client";

/** QuizModal — Chapter gatekeeper: 5 MCQs with ≥80% pass threshold. */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronRight, Trophy, Sparkles, AlertTriangle, Loader2 } from "lucide-react";

export interface QuizQuestion {
  question: string;
  options: Record<string, string>;
  answer: string;
  explanation: string;
}

interface Props {
  title: string;
  questions: QuizQuestion[];
  skipped?: boolean;
  skipReason?: string;
  onPass: () => void;
  onFail: (weakQuestions: QuizQuestion[]) => void;
  onClose: () => void;
}

const PASS_THRESHOLD = 0.8; // 80%

export default function QuizModal({ title, questions, skipped, skipReason, onPass, onFail, onClose }: Props) {
  const [step, setStep] = useState<"quiz" | "result" | "skipped">(skipped ? "skipped" : questions.length > 0 ? "quiz" : "skipped");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [showConfetti, setShowConfetti] = useState(false);
  const [score, setScore] = useState(0);

  // ── Auto-advance for skipped chapters ──
  useEffect(() => {
    if (step === "skipped") {
      const timer = setTimeout(() => {
        onPass();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [step, onPass]);

  const total = Math.min(questions.length, 5);
  const q = questions[currentIdx] ?? null;
  const selected = answers[currentIdx] ?? "";
  const allAnswered = Object.keys(answers).length >= total;

  const handleSelect = (letter: string) => {
    setAnswers((prev) => ({ ...prev, [currentIdx]: letter }));
  };

  const handleNext = () => {
    if (currentIdx < total - 1) {
      setCurrentIdx((i) => i + 1);
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) {
      setCurrentIdx((i) => i - 1);
    }
  };

  const submitQuiz = useCallback(() => {
    let correct = 0;
    const weak: QuizQuestion[] = [];
    for (let i = 0; i < total; i++) {
      const qq = questions[i];
      if (!qq) continue;
      if (answers[i]?.toUpperCase() === qq.answer.toUpperCase()) {
        correct++;
      } else {
        weak.push(qq);
      }
    }
    const pct = correct / total;
    setScore(Math.round(pct * 100));

    if (pct >= PASS_THRESHOLD) {
      setShowConfetti(true);
    }
    setStep("result");
  }, [answers, questions, total]);

  // Keyboard shortcuts
  useEffect(() => {
    if (step !== "quiz") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "4") {
        const letter = String.fromCharCode(65 + (parseInt(e.key) - 1)); // 1→A, 2→B...
        handleSelect(letter);
      }
      if (e.key === "Enter" && selected) {
        if (currentIdx < total - 1) handleNext();
        else if (allAnswered) submitQuiz();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [step, selected, currentIdx, allAnswered, submitQuiz, total]);

  const passed = score >= PASS_THRESHOLD * 100;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/50 flex items-center justify-center animate-in fade-in duration-200">
      <div
        className="bg-white rounded-2xl shadow-2xl w-[520px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-500" />
            <span className="text-sm font-semibold text-neutral-700">通关测试: {title}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-neutral-100 text-neutral-400 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {step === "skipped" && (
          <div className="flex flex-col items-center justify-center py-12 px-8 gap-4">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-green-700">
              本章为过渡章节，无需测试
            </h3>
            <p className="text-xs text-neutral-500 text-center">
              {skipReason || "内容较少，已为您免检放行"}
            </p>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mt-2">
              <div className="w-4 h-4 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
              即将自动进入下一章...
            </div>
            <button
              onClick={onPass}
              className="mt-2 px-6 py-2 text-sm font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors"
            >
              直接进入下一章
            </button>
          </div>
        )}

        {step === "quiz" && q && (
          <>
            {/* ── Progress bar ── */}
            <div className="px-5 pt-4 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-400">
                  第 {currentIdx + 1} / {total} 题
                </span>
                <span className="text-xs text-neutral-400">
                  已答 {Object.keys(answers).length}/{total}
                </span>
              </div>
              <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-300"
                  style={{ width: `${((currentIdx + 1) / total) * 100}%` }}
                />
              </div>
            </div>

            {/* ── Question ── */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <p className="text-sm font-medium text-neutral-800 leading-relaxed mb-4">
                {q.question}
              </p>

              <div className="space-y-2">
                {Object.entries(q.options).map(([letter, text]) => {
                  const isSelected = selected === letter;
                  return (
                    <button
                      key={letter}
                      onClick={() => handleSelect(letter)}
                      className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-all ${
                        isSelected
                          ? "border-amber-400 bg-amber-50 text-amber-900 font-medium"
                          : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 text-xs font-bold text-neutral-500 mr-2">
                        {letter}
                      </span>
                      {text}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Navigation ── */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-100 shrink-0">
              <button
                onClick={handlePrev}
                disabled={currentIdx === 0}
                className="px-3 py-1.5 text-xs rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                上一题
              </button>

              {currentIdx < total - 1 ? (
                <button
                  onClick={handleNext}
                  disabled={!selected}
                  className="inline-flex items-center gap-1 px-4 py-1.5 text-xs rounded-md bg-neutral-800 text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  下一题
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={submitQuiz}
                  disabled={!allAnswered}
                  className="inline-flex items-center gap-1 px-4 py-1.5 text-xs rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
                >
                  <Trophy size={14} />
                  提交答卷
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Result Screen ── */}
        {step === "result" && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-4">
            {showConfetti && (
              <ConfettiOverlay active={showConfetti} />
            )}

            {passed ? (
              <>
                <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                  <Trophy size={32} className="text-amber-500" />
                </div>
                <h3 className="text-lg font-bold text-neutral-800">通关成功！</h3>
                <p className="text-sm text-neutral-500 text-center">
                  你的得分: <span className="text-amber-600 font-bold">{score}%</span>
                </p>
                <div className="w-48 h-2 bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-400 rounded-full transition-all duration-700"
                    style={{ width: `${score}%` }}
                  />
                </div>
                <button
                  onClick={onPass}
                  className="inline-flex items-center gap-1.5 px-6 py-2.5 text-sm rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 transition-all mt-2"
                >
                  <ChevronRight size={16} />
                  进入下一章
                </button>
              </>
            ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                  <AlertTriangle size={32} className="text-red-500" />
                </div>
                <h3 className="text-lg font-bold text-neutral-800">还需巩固</h3>
                <p className="text-sm text-neutral-500 text-center">
                  你的得分: <span className="text-red-600 font-bold">{score}%</span>（通过线: 80%）
                </p>
                <p className="text-xs text-neutral-400 text-center max-w-xs">
                  已检测到薄弱环节，AI 导师已为你准备了针对性的复习任务，请在右侧
                  ChatPanel 中完成。
                </p>
                <button
                  onClick={() => {
                    const weak = questions.filter(
                      (qq, i) => answers[i]?.toUpperCase() !== qq.answer.toUpperCase()
                    );
                    onFail(weak);
                  }}
                  className="inline-flex items-center gap-1.5 px-6 py-2.5 text-sm rounded-lg bg-red-500 text-white hover:bg-red-600 transition-all mt-2"
                >
                  接受复习任务
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Lightweight confetti (pure CSS + canvas, no deps) ──

function ConfettiOverlay({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const canvas = document.getElementById("quiz-confetti") as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = (canvas.width = window.innerWidth);
    const H = (canvas.height = window.innerHeight);
    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * W,
      y: -10 - Math.random() * 60,
      w: 6 + Math.random() * 8,
      h: 3 + Math.random() * 5,
      color: ["#f59e0b", "#ef4444", "#3b82f6", "#10b981", "#8b5cf6"][Math.floor(Math.random() * 5)],
      vx: (Math.random() - 0.5) * 2,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 6,
      opacity: 1,
    }));

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rotV;
        if (p.y > H + 20) { p.y = -10; p.x = Math.random() * W; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
        p.opacity -= 0.003;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    const cleanup = setTimeout(() => { cancelAnimationFrame(raf); }, 4000);
    return () => { clearTimeout(cleanup); cancelAnimationFrame(raf); };
  }, [active]);

  return (
    <canvas
      id="quiz-confetti"
      className="fixed inset-0 z-[121] pointer-events-none"
      style={{ width: "100vw", height: "100vh" }}
    />
  );
}
