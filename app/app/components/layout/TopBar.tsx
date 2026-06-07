"use client";

import { useState } from "react";
import {
  PanelLeft,
  BookOpen,
  Globe,
  Sun,
  Moon,
  MessageSquare,
  Settings,
} from "lucide-react";
import { useReaderStore } from "@/lib/stores/readerStore";
import { useChatStore } from "@/lib/stores/chatStore";
import { useGraphStore } from "@/lib/stores/graphStore";
import type { Theme } from "@/lib/stores/readerStore";
import SettingsDialog from "./SettingsDialog";

interface Props {
  onToggleToc: () => void;
  bookName: string;
}

const THEME_ICONS: Record<Theme, React.ReactNode> = {
  day: <Sun size={16} />,
  warm: <BookOpen size={16} />,
  night: <Moon size={16} />,
};

export default function TopBar({ onToggleToc }: Props) {
  const { theme, readingMode, setTheme, setReadingMode } = useReaderStore();
  const { toggle: toggleChat, isOpen: chatOpen, open: openChat } = useChatStore();
  const { openModal } = useGraphStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const cycleTheme = () => {
    const order: Theme[] = ["day", "warm", "night"];
    const idx = order.indexOf(theme);
    setTheme(order[(idx + 1) % order.length]);
  };

  return (
    <>
      <header className="flex items-center justify-between h-12 px-4 border-b border-neutral-200 bg-white shrink-0 select-none">
        {/* Left group */}
        <div className="flex items-center gap-2">
          <button onClick={onToggleToc} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors" title="目录">
            <PanelLeft size={18} />
          </button>
          <span className="text-sm font-medium text-neutral-600 hidden sm:inline">FluxRead</span>
        </div>

        {/* Right group */}
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setSettingsOpen(true)} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors text-neutral-600" title="设置">
            <Settings size={16} />
          </button>

          <button onClick={cycleTheme} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors text-neutral-600" title={`主题: ${theme}`}>
            {THEME_ICONS[theme]}
          </button>

          <button onClick={openModal} className="p-1.5 rounded-md hover:bg-neutral-100 transition-colors text-neutral-600" title="知识图谱">
            <Globe size={18} />
          </button>

          <button
            onClick={() => {
              if (readingMode === "immersive") {
                setReadingMode("intensive");
                openChat();
              } else {
                toggleChat();
              }
            }}
            className={`p-1.5 rounded-md transition-colors ${chatOpen && readingMode === "intensive" ? "bg-neutral-800 text-white" : "hover:bg-neutral-100 text-neutral-600"}`}
            title="对话面板"
          >
            <MessageSquare size={18} />
          </button>
        </div>
      </header>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
