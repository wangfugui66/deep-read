"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Send, Plus, History, Trash2 } from "lucide-react";
import { streamSocraticChat, listChatSessions, readChatSession, createChatSession, deleteChatSession, appendChatMessage } from "@/lib/api_client";
import { useChatStore } from "@/lib/stores/chatStore";
import { useReaderStore } from "@/lib/stores/readerStore";
import type { ChatMessage, ChatSessionMeta } from "@/lib/stores/chatStore";

// ====================================================================
// ChatPanel — SSE streaming with file-based session persistence
// ====================================================================

interface Props {
  bookName: string;
}

export default function ChatPanel({ bookName }: Props) {
  const {
    isOpen,
    messages,
    isLoading,
    sessions,
    currentSessionId,
    close,
    addMessage,
    appendToLast,
    setLoading,
    setMessages,
    setSessions,
    setCurrentSessionId,
  } = useChatStore();

  const [inputText, setInputText] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const currentChapterPath = useReaderStore((s) => s.currentChapterPath);

  // ── Load sessions on mount ──
  useEffect(() => {
    if (!bookName) return;
    listChatSessions(bookName).then((s) => {
      setSessions(s);
      if (s.length > 0 && !currentSessionId) {
        setCurrentSessionId(s[0].session_id);
        loadSession(bookName, s[0].session_id);
      }
    }).catch(() => {});
  }, [bookName]);

  // ── Load a session's messages ──
  const loadSession = async (book: string, sid: string) => {
    try {
      const data = await readChatSession(book, sid);
      const msgs: ChatMessage[] = (data.messages || []).map((m: { role: string; content: string }, i: number) => ({
        id: `${sid}-${i}`,
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
      setMessages(msgs);
    } catch {
      setMessages([]);
    }
  };

  // ── New session ──
  const newSession = async () => {
    try {
      const s = await createChatSession(bookName);
      const refreshed = await listChatSessions(bookName);
      setSessions(refreshed);
      setCurrentSessionId(s.session_id);
      setMessages([]);
      setHistoryOpen(false);
    } catch {}
  };

  // ── Switch session ──
  const switchSession = (sid: string) => {
    setCurrentSessionId(sid);
    loadSession(bookName, sid);
    setHistoryOpen(false);
  };

  // ── Delete session ──
  const deleteSession = async (sid: string) => {
    try {
      await deleteChatSession(bookName, sid);
      const refreshed = await listChatSessions(bookName);
      setSessions(refreshed);
      if (currentSessionId === sid) {
        if (refreshed.length > 0) {
          setCurrentSessionId(refreshed[0].session_id);
          loadSession(bookName, refreshed[0].session_id);
        } else {
          setCurrentSessionId(null);
          setMessages([]);
        }
      }
    } catch {}
  };

  // ── Persist message ──
  const persistMsg = useCallback(
    (role: string, content: string) => {
      if (!currentSessionId) return;
      appendChatMessage(bookName, currentSessionId, role, content).catch(() => {});
    },
    [bookName, currentSessionId]
  );

  // ── Core send function ──
  const sendAction = useCallback(
    async (context: string) => {
      // Ensure a session exists
      let sid = currentSessionId;
      if (!sid) {
        try {
          const s = await createChatSession(bookName);
          sid = s.session_id;
          setCurrentSessionId(sid);
          const refreshed = await listChatSessions(bookName);
          setSessions(refreshed);
        } catch {
          return;
        }
      }

      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: context };
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "" };

      addMessage(userMsg);
      addMessage(assistantMsg);
      setLoading(true);

      // Persist user message
      persistMsg("user", context);

      let fullResponse = "";

      try {
        // Build chat history for backend context injection
        const history = messages
          .filter((m) => m.content && m.content.length > 0)
          .slice(-20)
          .map((m) => ({ role: m.role, content: m.content }));

        for await (const chunk of streamSocraticChat(
          bookName,
          context,
          currentChapterPath ?? "",
          history,
        )) {
          if (chunk.done) break;
          if (chunk.token) {
            fullResponse += chunk.token;
            appendToLast(chunk.token);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("chat streaming error:", msg);
        fullResponse += `\n\n❌ 系统异常：${msg}`;
        appendToLast(`\n\n❌ 系统异常：${msg}`);
      } finally {
        setLoading(false);
        if (fullResponse) persistMsg("assistant", fullResponse);

        // Refresh sessions list to show updated title
        listChatSessions(bookName).then(setSessions).catch(() => {});
      }
    },
    [addMessage, appendToLast, setLoading, currentSessionId, currentChapterPath, bookName, persistMsg, setSessions, setCurrentSessionId, messages]
  );

  const handleTextSubmit = () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    sendAction(text);
  };

  if (!isOpen) return null;

  return (
    <aside className="flex flex-col w-80 border-l border-neutral-200 bg-white shrink-0 h-full relative">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-neutral-200 shrink-0">
        <h3 className="text-sm font-semibold text-neutral-700">费曼精读</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={newSession}
            className="p-1 rounded-md hover:bg-neutral-100 transition-colors text-neutral-500"
            title="新建对话"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="p-1 rounded-md hover:bg-neutral-100 transition-colors text-neutral-500"
            title="历史记录"
          >
            <History size={14} />
          </button>
          <button onClick={close} className="p-1 rounded-md hover:bg-neutral-100 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* History drawer */}
      {historyOpen && (
        <div className="absolute top-12 right-0 w-64 bg-white border border-neutral-200 rounded-bl-lg shadow-lg z-50 max-h-72 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-medium text-neutral-400 border-b border-neutral-100">历史对话</div>
          {sessions.length === 0 && (
            <div className="px-3 py-4 text-xs text-neutral-400 text-center">暂无对话</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.session_id}
              onClick={() => switchSession(s.session_id)}
              className={`w-full text-left px-3 py-2 text-xs border-b border-neutral-50 hover:bg-neutral-50 flex items-center justify-between group ${
                s.session_id === currentSessionId ? "bg-neutral-100" : ""
              }`}
            >
              <span className="truncate flex-1">{s.title || "新对话"}</span>
              <span
                onClick={(e) => { e.stopPropagation(); deleteSession(s.session_id); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 text-red-400 transition-opacity"
                title="删除"
              >
                <Trash2 size={10} />
              </span>
            </button>
          ))}
          <div className="px-3 py-2 border-t border-neutral-100">
            <button onClick={newSession} className="w-full text-xs text-neutral-500 hover:text-neutral-700 py-1">
              + 新建对话
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-sm text-neutral-400 mt-8 leading-relaxed">
            <p>在阅读页面选中文中任意文字，</p>
            <p>在浮出工具栏可点击 <strong>解释</strong> 或 <strong>联想</strong></p>
            <p className="mt-2 text-neutral-300">—— 或直接在下方输入你的问题 ——</p>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`text-sm leading-relaxed px-3 py-2 rounded-lg ${
              m.role === "assistant"
                ? "bg-neutral-100 text-neutral-800"
                : "bg-blue-50 text-blue-900"
            }`}
          >
            {m.content || (m.role === "assistant" && isLoading ? "…" : "")}
          </div>
        ))}

        {isLoading && messages.length > 0 && (
          <div className="text-xs text-neutral-400 animate-pulse text-center">
            DeepSeek 思考中…
          </div>
        )}
      </div>

      {/* Text input */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleTextSubmit(); }}
        className="flex items-center gap-2 px-4 py-3 border-t border-neutral-200 shrink-0"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="输入你的问题…"
          className="flex-1 text-sm px-3 py-1.5 rounded-md border border-neutral-200 bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || isLoading}
          className="p-1.5 rounded-md bg-neutral-800 text-white disabled:opacity-30 transition-opacity"
        >
          <Send size={14} />
        </button>
      </form>
    </aside>
  );
}
