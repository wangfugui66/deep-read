"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  ArrowRight, CheckCircle2, Loader2, AlertCircle,
  Brain, Clock, User, BookOpen, MessageCircle, Send, Sparkles,
} from "lucide-react";
import {
  convergeSaveBaseline, convergeNext, convergeSaveFinal,
} from "@/lib/api_client";
import type { ConvergeNextResponse, ConvergeHistoryItem } from "@/lib/api_client";

// ====================================================================
// ProfileWizard — Task 2+3+5: Baseline → Multi-round Socratic → Auto Skeleton
//
// Steps:
//   0  — Baseline intake form
//   1  — Socratic rounds (1–10, single question each)
//   P  — Learning preference
//   D  — Done → auto chains skeleton generation
// ====================================================================

type Phase = "baseline" | "socratic" | "preference" | "generating" | "done";

const KNOWLEDGE_LEVELS = [
  { id: "纯小白", label: "纯小白 — 首次接触这个领域" },
  { id: "零散了解过", label: "零散了解过 — 看过一些文章/视频" },
  { id: "具备系统性知识", label: "具备系统性知识 — 学过完整课程" },
  { id: "资深从业者", label: "资深从业者 — 日常工作就是这个方向" },
];

interface Props {
  bookName: string;
  onComplete: () => void;
  onProfileComplete?: () => void;
}

export default function ProfileWizard({ bookName, onComplete, onProfileComplete }: Props) {

  // ── Baseline form state ──
  const [profession, setProfession] = useState("");
  const [knowledgeLevel, setKnowledgeLevel] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState(30);
  const [plannedDays, setPlannedDays] = useState(7);

  // ── Socratic round state ──
  const [phase, setPhase] = useState<Phase>("baseline");
  const [roundNum, setRoundNum] = useState(0);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<Record<string, string>>({});
  const [selectedOption, setSelectedOption] = useState("");
  const [freeText, setFreeText] = useState("");
  const [showFreeText, setShowFreeText] = useState(false);
  const [history, setHistory] = useState<ConvergeHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxRounds = 10;

  // ── Final state ──
  const [diagnosisConclusion, setDiagnosisConclusion] = useState("");
  const [cognitiveGaps, setCognitiveGaps] = useState<string[]>([]);
  const [difficultyHint, setDifficultyHint] = useState("");
  const [learningPref, setLearningPref] = useState<"theory_first" | "story_first" | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [phase, roundNum, showFreeText]);

  // ── Step 0 → Socratic: Save baseline, get first question ──
  const handleBaselineSubmit = async () => {
    if (!profession.trim() || !knowledgeLevel || !painPoint.trim()) return;

    // ══════ Payload Guard (Task 3) ══════
    console.log("=== 正在检查 API Payload ===");
    console.log("传入的 Props.bookName:", bookName);
    if (typeof window !== "undefined") {
      console.log("当前 URL:", window.location.href);
    }
    if (bookName.includes("目录")) {
      alert("前端拦截：书名被污染为目录！请检查代码。");
      return; // Physical block — never send polluted book_name
    }

    setLoading(true);
    setError(null);
    try {
      await convergeSaveBaseline(bookName, {
        profession: profession.trim(),
        knowledge_level: knowledgeLevel,
        pain_point: painPoint.trim(),
        daily_minutes: dailyMinutes,
        planned_days: plannedDays,
      });

      // Get first question
      const res = await convergeNext(bookName, 1, profession.trim(), knowledgeLevel, painPoint.trim(), []);
      setRoundNum(1);
      setQuestion(res.question);
      setOptions(res.options ?? {});
      setPhase("socratic");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Baseline save failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Socratic round: submit answer ──
  const handleSocraticSubmit = async () => {
    if (!selectedOption) return;
    const isE = selectedOption.startsWith("E");

    if (isE && !freeText.trim() && !showFreeText) {
      setShowFreeText(true);
      return;
    }

    const selectedLabel = isE ? `E. ${freeText.trim()}` : selectedOption;
    const nextHistory = [...history, { question, selected: selectedLabel }];

    setLoading(true);
    setError(null);
    try {
      const nextRound = roundNum + 1;
      const res: ConvergeNextResponse = await convergeNext(
        bookName,
        nextRound,
        profession.trim(),
        knowledgeLevel,
        painPoint.trim(),
        nextHistory,
        isE ? freeText.trim() : undefined,
      );

      setHistory(nextHistory);
      setSelectedOption("");
      setFreeText("");
      setShowFreeText(false);

      if (res.is_converged || nextRound > maxRounds) {
        // Converged — save diagnosis, extract cognitive gaps
        setDiagnosisConclusion(res.diagnosis_conclusion || "诊断完成");
        setCognitiveGaps(extractGaps(res.diagnosis_conclusion));
        setDifficultyHint("intermediate");
        setPhase("preference");
      } else {
        setRoundNum(nextRound);
        setQuestion(res.question);
        setOptions(res.options ?? {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Round failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Escape hatch: skip to skeleton with partial context ──
  const handleEscapeToSkeleton = async () => {
    setLoading(true);
    setError(null);
    try {
      // Build a partial diagnosis from whatever we have
      const partialConclusion = history.length > 0
        ? `未完成诊断（用户在第 ${roundNum} 轮选择跳过）。已收集 ${history.length} 轮回答。`
        : "用户直接跳过诊断，未提供追问信息。";

      await convergeSaveFinal(bookName, {
        profession: profession.trim(),
        knowledge_level: knowledgeLevel,
        pain_point: painPoint.trim(),
        learning_preference: "theory_first", // default
        daily_minutes: dailyMinutes,
        planned_days: plannedDays,
        diagnosis_conclusion: partialConclusion,
        cognitive_gaps: [],
        difficulty_hint: "intermediate",
        convergence_history: history,
      });

      console.log("🔥🔥🔥 Profile 保存成功（逃生舱），准备触发 onProfileComplete");
      onProfileComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Escape save failed");
    } finally {
      setLoading(false);
    }
  };
  const handlePreferenceSubmit = async () => {
    if (!learningPref) return;
    setLoading(true);
    setError(null);
    try {
      await convergeSaveFinal(bookName, {
        profession: profession.trim(),
        knowledge_level: knowledgeLevel,
        pain_point: painPoint.trim(),
        learning_preference: learningPref,
        daily_minutes: dailyMinutes,
        planned_days: plannedDays,
        diagnosis_conclusion: diagnosisConclusion,
        cognitive_gaps: cognitiveGaps,
        difficulty_hint: difficultyHint,
        convergence_history: history,
      });

      console.log("🔥🔥🔥 Profile 保存成功（完整诊断），准备触发 onProfileComplete");
      onProfileComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──

  if (phase === "done") {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-4">
        <CheckCircle2 size={48} className="text-emerald-400" />
        <div>
          <h3 className="text-lg font-semibold text-neutral-800">深度画像已确诊</h3>
          <p className="text-sm text-neutral-500 mt-1">
            正在为您量身重组《{bookName}》的知识骨架…
          </p>
          {diagnosisConclusion && (
            <p className="text-xs text-neutral-400 mt-3 italic max-w-sm mx-auto">
              「{diagnosisConclusion}」
            </p>
          )}
        </div>
        <button
          onClick={onComplete}
          className="px-6 py-2 text-sm rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 transition-colors"
        >
          查看定制骨架
        </button>
      </div>
    );
  }

  if (phase === "generating") {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-3">
        <Loader2 size={40} className="animate-spin text-neutral-400" />
        <p className="text-sm font-medium text-neutral-700">
          正在为您量身重组《{bookName}》的知识骨架…
        </p>
        <p className="text-xs text-neutral-400">AI 正在根据你的认知缺口和阅读时间预算，生成四级策略矩阵</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      <div className="flex items-center gap-1 px-4 py-3 border-b border-neutral-100">
        <div className={`h-1 flex-1 rounded-full transition-colors ${phase === "baseline" ? "bg-neutral-400" : "bg-neutral-800"}`} />
        <div className={`h-1 flex-1 rounded-full transition-colors ${phase === "socratic" ? "bg-neutral-400" : (phase !== "baseline" ? "bg-neutral-800" : "bg-neutral-100")}`} />
        <div className={`h-1 flex-1 rounded-full transition-colors ${phase === "preference" ? "bg-neutral-400" : (phase !== "baseline" && phase !== "socratic" ? "bg-neutral-800" : "bg-neutral-100")}`} />
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5" ref={bottomRef}>
        {/* ── PHASE: BASELINE ── */}
        {phase === "baseline" && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-neutral-800 mb-1">建立学习基线</h3>
              <p className="text-xs text-neutral-400">AI 需要了解你的背景，才能精准诊断认知缺口</p>
            </div>

            {/* Profession */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                <User size={13} /> 您的专业或当前从事的行业？
              </label>
              <input
                type="text"
                value={profession}
                onChange={(e) => setProfession(e.target.value)}
                placeholder="例如：后端开发工程师、生物医药研究员…"
                className="w-full text-sm px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                disabled={loading}
              />
            </div>

            {/* Knowledge level */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                <BookOpen size={13} /> 您对《{bookName}》相关领域的了解程度？
              </label>
              <div className="space-y-1.5">
                {KNOWLEDGE_LEVELS.map((kl) => (
                  <label
                    key={kl.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-md border text-xs cursor-pointer transition-colors ${
                      knowledgeLevel === kl.id
                        ? "border-neutral-800 bg-neutral-50 text-neutral-900"
                        : "border-neutral-200 text-neutral-500 hover:border-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="knowledge_level"
                      value={kl.id}
                      checked={knowledgeLevel === kl.id}
                      onChange={() => setKnowledgeLevel(kl.id)}
                      className="sr-only"
                    />
                    <span className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{ borderColor: knowledgeLevel === kl.id ? "currentColor" : undefined }}>
                      {knowledgeLevel === kl.id && <span className="w-2 h-2 rounded-full bg-neutral-800" />}
                    </span>
                    {kl.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Pain point */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                <MessageCircle size={13} /> 您翻开这本书，最想解决的一个具体问题？
              </label>
              <textarea
                value={painPoint}
                onChange={(e) => setPainPoint(e.target.value)}
                placeholder="例如：如何设计一个健壮的agent编排系统？不知道从哪入手…"
                className="w-full h-24 text-sm px-3 py-2.5 rounded-lg border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300 resize-none"
                disabled={loading}
              />
            </div>

            {/* Time budget */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                  <Clock size={13} /> 每天阅读（分钟）
                </label>
                <select
                  value={dailyMinutes}
                  onChange={(e) => setDailyMinutes(Number(e.target.value))}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                >
                  {[15, 30, 45, 60, 90, 120].map((m) => (
                    <option key={m} value={m}>{m} 分钟</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-neutral-600">
                  <Clock size={13} /> 计划完成（天数）
                </label>
                <select
                  value={plannedDays}
                  onChange={(e) => setPlannedDays(Number(e.target.value))}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                >
                  {[3, 5, 7, 10, 14, 21, 30].map((d) => (
                    <option key={d} value={d}>{d} 天</option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-[10px] text-neutral-400 text-right">
              阅读预算：{dailyMinutes * plannedDays * 500} 字（{dailyMinutes}分×{plannedDays}天×500字/分）
            </p>

            <button
              onClick={handleBaselineSubmit}
              disabled={!profession.trim() || !knowledgeLevel || !painPoint.trim() || loading}
              className="flex items-center justify-center gap-2 w-full py-2.5 text-sm rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {loading ? "保存中…" : "开始深度诊断"}
            </button>
          </div>
        )}

        {/* ── PHASE: SOCRATIC ── */}
        {phase === "socratic" && (
          <div className="space-y-5">
            {/* Round counter */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-400">深度追问 · 第 {roundNum} 轮</span>
              <span className="text-[10px] text-neutral-300">共 {maxRounds} 轮 · 可提前结束</span>
            </div>

            {/* Current question */}
            <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4">
              <p className="text-sm text-neutral-800 leading-relaxed">{question}</p>
            </div>

            {/* Options */}
            <div className="space-y-1.5">
              {Object.entries(options).map(([key, label]) => {
                const isE = key === "E";
                return (
                  <label
                    key={key}
                    className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                      selectedOption === key
                        ? "border-neutral-800 bg-neutral-50 text-neutral-900"
                        : isE ? "border-purple-200 text-purple-600 hover:border-purple-300" : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`socratic-${roundNum}`}
                      value={key}
                      checked={selectedOption === key}
                      onChange={() => {
                        setSelectedOption(key);
                        if (!isE) setShowFreeText(false);
                      }}
                      className="sr-only"
                    />
                    <span className="w-8 h-5 rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-500 flex items-center justify-center shrink-0">
                      {key}
                    </span>
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>

            {/* Free-text for option E */}
            {(showFreeText || selectedOption === "E") && (
              <div className="relative">
                <textarea
                  autoFocus
                  value={freeText}
                  onChange={(e) => setFreeText(e.target.value)}
                  placeholder="请详细描述您的情况…"
                  className="w-full h-20 text-sm px-3 py-2.5 rounded-lg border border-purple-200 bg-purple-50 focus:outline-none focus:ring-2 focus:ring-purple-300 resize-none"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleSocraticSubmit}
                disabled={!selectedOption || loading || (selectedOption === "E" && !freeText.trim())}
                className="flex items-center justify-center gap-2 flex-1 py-2.5 text-sm rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {loading ? "思考中…" : selectedOption === "E" && !showFreeText ? "详细描述" : "提交回答"}
              </button>

              {/* Escape hatch */}
              <button
                onClick={handleEscapeToSkeleton}
                disabled={loading}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:border-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
                title="用已有回答直接生成专属骨架"
              >
                🎯 目的已明确，直接生成专属书架
              </button>
            </div>
          </div>
        )}

        {/* ── PHASE: PREFERENCE ── */}
        {phase === "preference" && (
          <div className="space-y-5">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Brain size={16} className="text-emerald-600" />
                <span className="text-xs font-semibold text-emerald-700">确诊画像</span>
              </div>
              <p className="text-sm text-neutral-700 leading-relaxed">{diagnosisConclusion}</p>
              {cognitiveGaps.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {cognitiveGaps.map((g, i) => (
                    <span key={i} className="px-2 py-0.5 text-[10px] rounded-full bg-amber-100 text-amber-700 font-medium">
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <span className="text-xs font-medium text-neutral-600">最后一步：学习路径偏好</span>
              {([
                { id: "theory_first" as const, label: "A. 先懂底层理论，再看案例应用" },
                { id: "story_first" as const, label: "B. 先看故事案例，再总结底层法则" },
              ]).map((opt) => (
                <label
                  key={opt.id}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-xs cursor-pointer transition-colors ${
                    learningPref === opt.id
                      ? "border-neutral-800 bg-neutral-50 text-neutral-900"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="preference"
                    value={opt.id}
                    checked={learningPref === opt.id}
                    onChange={() => setLearningPref(opt.id)}
                    className="sr-only"
                  />
                  <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    learningPref === opt.id ? "border-neutral-800" : "border-neutral-300"
                  }`}>
                    {learningPref === opt.id && <span className="w-2 h-2 rounded-full bg-neutral-800" />}
                  </span>
                  {opt.label}
                </label>
              ))}
            </div>

            <button
              onClick={handlePreferenceSubmit}
              disabled={!learningPref || loading}
              className="flex items-center justify-center gap-2 w-full py-2.5 text-sm rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {loading ? "保存中…" : "完成，生成定制骨架"}
            </button>
          </div>
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-md bg-red-50 border border-red-200 flex items-center gap-2 text-xs text-red-600">
          <AlertCircle size={12} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}
    </div>
  );
}

/** Extract cognitive gap labels from diagnosis text via simple heuristics. */
function extractGaps(text: string): string[] {
  if (!text) return [];
  // Try to extract 3-5 word phrases
  const phrases = text.split(/[，,。；;、\n]/).filter((p) => p.length >= 4 && p.length <= 30);
  return phrases.slice(0, 5);
}
