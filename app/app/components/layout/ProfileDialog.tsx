"use client";

/** ProfileWizard — 4-step form to build learning profile. Sends data via PUT /api/profile/{book_name}. */

import { useState, useEffect } from "react";
import { X, Loader2, Sparkles, FileQuestion, ChevronRight, ChevronLeft, Check } from "lucide-react";
import { fetchProfile, saveProfile, deleteProfile } from "@/lib/api_client";
import type { LearningProfile } from "@/lib/types";

interface Props {
  bookName: string;
  open: boolean;
  onClose: () => void;
}

type WizardStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<WizardStep, string> = {
  1: "领域基线",
  2: "痛点导向",
  3: "认知偏好",
  4: "时间预算",
};

export default function ProfileDialog({ bookName, open, onClose }: Props) {
  // ── States ──
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard
  const [isWizard, setIsWizard] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [saving, setSaving] = useState(false);

  // Wizard form data
  const [baselineLevel, setBaselineLevel] = useState("");
  const [baselineConcepts, setBaselineConcepts] = useState("");
  const [painPoint, setPainPoint] = useState("");
  const [cognitivePref, setCognitivePref] = useState("");
  const [timeBudget, setTimeBudget] = useState("");

  // ── Load existing profile on open ──
  useEffect(() => {
    if (!open || !bookName) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    setHasProfile(false);
    setIsWizard(false);
    fetchProfile(bookName)
      .then((p) => {
        setHasProfile(true);
        // Pre-fill wizard fields from existing profile (v2 hierarchical schema)
        setBaselineLevel(p.core_memory?.knowledge_level || p.knowledge_baseline || "");
        setPainPoint(p.core_memory?.pain_point || p.pain_point || "");
        setCognitivePref(p.core_memory?.learning_style || p.cognitive_preference || "");
        setTimeBudget(p.time_budget_minutes ? String(p.time_budget_minutes) : "");
      })
      .catch((e) => {
        const msg: string = e?.message ?? "";
        if (msg.includes("404") || msg.includes("not found")) {
          setNotFound(true);
        } else {
          setError(msg || "Failed to load profile");
        }
      })
      .finally(() => setLoading(false));
  }, [open, bookName]);

  // ── Wizard: Collect and save ──
  const handleStartWizard = () => {
    setIsWizard(true);
    setStep(1);
    setBaselineLevel("");
    setBaselineConcepts("");
    setPainPoint("");
    setCognitivePref("");
    setTimeBudget("");
  };

  const nextStep = () => setStep((s) => Math.min(s + 1, 4) as WizardStep);
  const prevStep = () => setStep((s) => Math.max(s - 1, 1) as WizardStep);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const mode = baselineLevel === "从业者" ? "ATTACK" : "ROAM";
      const timeMin =
        timeBudget === "600+" ? 600 :
        timeBudget === "180" ? 180 :
        timeBudget === "60" ? 60 : 60;

      await saveProfile(bookName, {
        reading_mode: mode,
        knowledge_baseline: `${baselineLevel}${baselineConcepts ? ": " + baselineConcepts : ""}`,
        pain_point: painPoint,
        cognitive_preference: cognitivePref,
        time_budget_minutes: timeMin,
      });
      setIsWizard(false);
      setHasProfile(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("确定要重置学习档案吗？")) return;
    try {
      await deleteProfile(bookName);
      setHasProfile(false);
      setNotFound(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reset failed");
    }
  };

  if (!open) return null;

  // ── Step indicator ──
  const renderSteps = () => (
    <div className="flex items-center justify-center gap-1 mb-5">
      {([1, 2, 3, 4] as WizardStep[]).map((s) => (
        <div key={s} className="flex items-center gap-1">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all ${
              s < step
                ? "bg-green-100 text-green-600"
                : s === step
                ? "bg-neutral-800 text-white"
                : "bg-neutral-100 text-neutral-400"
            }`}
          >
            {s < step ? <Check size={10} /> : s}
          </div>
          <span className={`text-[10px] hidden sm:inline ${
            s <= step ? "text-neutral-600" : "text-neutral-300"
          }`}>
            {STEP_LABELS[s]}
          </span>
          {s < 4 && <div className="w-4 h-px bg-neutral-200" />}
        </div>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 shrink-0">
          <h3 className="text-sm font-semibold text-neutral-800">
            {isWizard ? "建立学习档案" : "学习档案"}
          </h3>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-neutral-100">
            <X size={16} className="text-neutral-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 size={20} className="animate-spin text-neutral-300" />
              <span className="text-sm text-neutral-400">加载中…</span>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="text-center py-8">
              <p className="text-sm text-red-500 mb-3">{error}</p>
              <button onClick={onClose} className="px-4 py-1.5 text-xs rounded-md bg-neutral-100 text-neutral-600 hover:bg-neutral-200">关闭</button>
            </div>
          )}

          {/* 404 — not yet established, not in wizard */}
          {!loading && notFound && !isWizard && (
            <div className="text-center py-8">
              <FileQuestion size={36} className="text-neutral-300 mx-auto mb-3" />
              <h4 className="text-sm font-medium text-neutral-600 mb-1">
                该书尚未建立您的专属学习档案
              </h4>
              <p className="text-xs text-neutral-400 mb-5 leading-relaxed">
                回答 4 个问题，AI 将为您生成个性化阅读策略
              </p>
              <button
                onClick={handleStartWizard}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 transition-colors"
              >
                <Sparkles size={13} />
                开启画像探测
              </button>
            </div>
          )}

          {/* Existing profile — show summary + edit/delete */}
          {!loading && hasProfile && !isWizard && (
            <div className="text-center py-4 space-y-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                <Check size={12} /> 专属画像已就绪
              </div>
              <p className="text-xs text-neutral-400">
                AI 将根据此画像定制费曼问答和阅读路径
              </p>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={handleStartWizard}
                  className="px-4 py-1.5 text-xs rounded-md bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition-colors"
                >
                  修改画像
                </button>
                <button
                  onClick={handleReset}
                  className="px-4 py-1.5 text-xs rounded-md text-red-500 hover:bg-red-50 transition-colors"
                >
                  重置档案
                </button>
              </div>
            </div>
          )}

          {/* ── Wizard Steps ── */}
          {isWizard && (
            <>
              {renderSteps()}

              {/* Step 1: Domain Baseline */}
              {step === 1 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-neutral-700">对该领域的熟悉程度</h4>
                  <div className="space-y-2">
                    {[
                      { value: "零基础", label: "零基础", desc: "第一次接触这个领域" },
                      { value: "了解过核心概念", label: "了解过核心概念", desc: "听说过一些术语，但未深入" },
                      { value: "行业从业者", label: "行业从业者", desc: "已有实践经验或学术基础" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setBaselineLevel(opt.value)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          baselineLevel === opt.value
                            ? "border-neutral-800 bg-neutral-50"
                            : "border-neutral-200 hover:border-neutral-300"
                        }`}
                      >
                        <span className="text-sm font-medium text-neutral-700">{opt.label}</span>
                        <span className="text-xs text-neutral-400 block mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                  <div>
                    <label className="text-xs text-neutral-500">脑海中已有的相关概念（可选）</label>
                    <input
                      type="text"
                      value={baselineConcepts}
                      onChange={(e) => setBaselineConcepts(e.target.value)}
                      placeholder="如：热力学、熵、系统论…"
                      className="w-full mt-1 text-sm border border-neutral-200 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
                    />
                  </div>
                </div>
              )}

              {/* Step 2: Pain Point */}
              {step === 2 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-neutral-700">
                    您当前遇到最棘手的问题是什么？
                  </h4>
                  <p className="text-xs text-neutral-400">
                    希望本书解决什么具体痛点？
                  </p>
                  <textarea
                    value={painPoint}
                    onChange={(e) => setPainPoint(e.target.value)}
                    placeholder="例如：我理解熵增定律的定义，但不知道如何用它解释组织中为什么会出现官僚化…"
                    rows={5}
                    className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-neutral-300"
                  />
                </div>
              )}

              {/* Step 3: Cognitive Preference */}
              {step === 3 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-neutral-700">您的信息获取偏好</h4>
                  <div className="space-y-2">
                    {[
                      { value: "story_first", label: "先看故事案例，再看总结法则", desc: "喜欢从具体场景切入，再提炼抽象规律" },
                      { value: "theory_first", label: "先懂底层理论，再看如何应用", desc: "喜欢先建立知识框架，再填充案例" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setCognitivePref(opt.value)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          cognitivePref === opt.value
                            ? "border-neutral-800 bg-neutral-50"
                            : "border-neutral-200 hover:border-neutral-300"
                        }`}
                      >
                        <span className="text-sm font-medium text-neutral-700">{opt.label}</span>
                        <span className="text-xs text-neutral-400 block mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 4: Time Budget */}
              {step === 4 && (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium text-neutral-700">阅读时间投入</h4>
                  <div className="space-y-2">
                    {[
                      { value: "60", label: "随便翻翻（1 小时内）", desc: "快速定位关键信息" },
                      { value: "180", label: "寻找具体答案（1-3 小时）", desc: "针对性学习特定章节" },
                      { value: "600+", label: "系统性精读（10 小时以上）", desc: "全面深入学习整本书" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setTimeBudget(opt.value)}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          timeBudget === opt.value
                            ? "border-neutral-800 bg-neutral-50"
                            : "border-neutral-200 hover:border-neutral-300"
                        }`}
                      >
                        <span className="text-sm font-medium text-neutral-700">{opt.label}</span>
                        <span className="text-xs text-neutral-400 block mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between mt-6">
                {step > 1 ? (
                  <button
                    onClick={prevStep}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md text-neutral-500 hover:bg-neutral-100"
                  >
                    <ChevronLeft size={12} /> 上一步
                  </button>
                ) : (
                  <button
                    onClick={() => setIsWizard(false)}
                    className="px-3 py-1.5 text-xs rounded-md text-neutral-500 hover:bg-neutral-100"
                  >
                    取消
                  </button>
                )}

                {step < 4 ? (
                  <button
                    onClick={nextStep}
                    disabled={step === 2 && !painPoint.trim()}
                    className="inline-flex items-center gap-1 px-4 py-1.5 text-xs rounded-md bg-neutral-800 text-white hover:bg-neutral-700 disabled:opacity-40"
                  >
                    下一步 <ChevronRight size={12} />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-5 py-2 text-xs rounded-lg bg-neutral-800 text-white hover:bg-neutral-700 disabled:opacity-50 transition-all"
                  >
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {saving ? "保存中…" : "生成专属画像"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
