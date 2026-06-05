"use client";

import { useState, useEffect } from "react";
import { Settings, X, Eye, EyeOff } from "lucide-react";

const KEY_STORAGE = "dr-api-key";

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(KEY_STORAGE) ?? "";
}

export function setApiKey(key: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(KEY_STORAGE, key);
  }
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ open, onClose }: Props) {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setKey(getApiKey());
      setSaved(false);
    }
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    setApiKey(key.trim());
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20">
      <div className="bg-white rounded-xl shadow-2xl w-[420px] max-w-[90vw] p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-neutral-500" />
            <h3 className="text-sm font-semibold text-neutral-700">设置</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-neutral-100">
            <X size={14} />
          </button>
        </div>

        <label className="block text-xs text-neutral-500 mb-1.5">
          DeepSeek API Key
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-..."
              className="w-full pl-3 pr-8 py-1.5 text-sm rounded-md border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400"
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={!key.trim()}
            className="px-3 py-1.5 text-xs rounded-md bg-neutral-800 text-white disabled:opacity-30 transition-opacity"
          >
            {saved ? "已保存 ✓" : "保存"}
          </button>
        </div>

        <p className="text-xs text-neutral-400 mt-3 leading-relaxed">
          Key 仅保存在浏览器本地，用于调用 DeepSeek API 进行解释、联想、费曼精读等功能。
        </p>
      </div>
    </div>
  );
}
