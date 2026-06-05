import { create } from "zustand";

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

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

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
