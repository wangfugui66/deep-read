import { create } from "zustand";

// ====================================================================
// Utility — extract a human-readable title from first user message
// ====================================================================

/**
 * Extract a short title (≤15 chars) from the user's first message.
 * Strips markdown blockquotes, leading punctuation, and whitespace.
 * Falls back to "新对话" if nothing meaningful remains.
 */
export function extractChatTitle(content: string): string {
  // 1. Strip markdown blockquote markers per line
  let cleaned = content.replace(/^>\s*/gm, "");
  // 2. Strip leading punctuation and whitespace
  cleaned = cleaned.replace(/^[\s\p{P}]+/u, "");
  // 3. Take first 12 meaningful characters
  const head = cleaned.slice(0, 12);
  if (!head) return "新对话";
  return head + (cleaned.length > 12 ? "..." : "");
}

// ====================================================================
// Chat Store — dialogue panel state + session management (client-side only)
// ====================================================================

export type ChatAction = "explain" | "associate";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ChatSessionMeta {
  session_id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  isLoading: boolean;

  // Session management
  sessions: ChatSessionMeta[];
  currentSessionId: string | null;

  // Panel state
  toggle: () => void;
  open: () => void;
  close: () => void;

  // Message management
  addMessage: (msg: ChatMessage) => void;
  appendToLast: (token: string) => void;
  clearMessages: () => void;
  setLoading: (v: boolean) => void;
  setMessages: (msgs: ChatMessage[]) => void;

  // Session management
  setSessions: (s: ChatSessionMeta[]) => void;
  setCurrentSessionId: (id: string | null) => void;

  // External trigger (deprecated — SelectionToolbar uses popover now)
  pendingAction: { action: ChatAction; context: string } | null;
  dispatchAction: (action: ChatAction, context: string) => void;
  clearPendingAction: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  isOpen: true,
  messages: [],
  isLoading: false,
  sessions: [],
  currentSessionId: null,
  pendingAction: null,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  addMessage: (msg) =>
    set((s) => {
      const newMessages = [...s.messages, msg];

      // ── Auto-title on first user message ──
      if (msg.role === "user" && s.currentSessionId) {
        const precedingUserCount = s.messages.filter((m) => m.role === "user").length;
        if (precedingUserCount === 0) {
          const newTitle = extractChatTitle(msg.content);
          const newSessions = s.sessions.map((sess) =>
            sess.session_id === s.currentSessionId
              ? { ...sess, title: newTitle }
              : sess,
          );
          return { messages: newMessages, sessions: newSessions };
        }
      }

      return { messages: newMessages };
    }),

  appendToLast: (token) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + token };
      }
      return { messages: msgs };
    }),

  clearMessages: () => set({ messages: [] }),
  setLoading: (v) => set({ isLoading: v }),
  setMessages: (msgs) => set({ messages: msgs }),

  setSessions: (sessions) => set({ sessions }),
  setCurrentSessionId: (id) => set({ currentSessionId: id }),

  dispatchAction: (action, context) => {
    set({ pendingAction: { action, context }, isOpen: true });
  },
  clearPendingAction: () => set({ pendingAction: null }),
}));
