import { create } from "zustand";
import type { NoteListItem } from "@/lib/types";
import { listNotes, saveUserNote, deleteNote } from "@/lib/api_client";

interface NoteState {
  notes: NoteListItem[];
  loading: boolean;

  /** Fetch notes from backend and replace local state. */
  loadNotes: (bookName: string) => Promise<void>;

  /** Save a note then reload. Returns true on success. */
  saveNote: (bookName: string, quote: string, content: string) => Promise<boolean>;

  /** Delete a note then reload. Returns true on success. */
  removeNote: (bookName: string, noteId: string) => Promise<boolean>;

  /** Clear all notes (e.g. on book switch). */
  clear: () => void;

  /** Incremented on every mutation — signals ReaderView to re-mark. */
  version: number;
}

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: [],
  loading: false,
  version: 0,

  loadNotes: async (bookName) => {
    set({ loading: true });
    try {
      const data = await listNotes(bookName);
      set({ notes: data, loading: false });
    } catch {
      set({ notes: [], loading: false });
    }
  },

  saveNote: async (bookName, quote, content) => {
    try {
      await saveUserNote(bookName, quote, content);
      const data = await listNotes(bookName);
      // Immutable — always new array reference
      set((s) => ({ notes: [...data], version: s.version + 1 }));
      return true;
    } catch {
      return false;
    }
  },

  removeNote: async (bookName, noteId) => {
    try {
      await deleteNote(bookName, noteId);
      const data = await listNotes(bookName);
      // Immutable — filter produces new array, no .splice()
      set((s) => ({ notes: [...data], version: s.version + 1 }));
      return true;
    } catch {
      return false;
    }
  },

  clear: () => set({ notes: [], version: 0 }),
}));
