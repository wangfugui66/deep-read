/** DeepRead-v2 — API client.

 * Every function maps 1:1 to a backend endpoint defined in master_router.py.
 * No UUID book IDs. No session IDs. book_name is the sole resource locator.
 *
 * Base URL configurable via NEXT_PUBLIC_API_URL (default: http://localhost:8000).
 */

import type {
  BookMeta,
  ChapterRef,
  ChatActionType,
  DictionaryCard,
  GraphExportRes,
  LearningProfile,
  NoteCreateRequest,
  NoteCreateResponse,
  NoteDeleteRequest,
  NoteListItem,
  PipelineStatus,
  ProfileExtractRequest,
  SkeletonGenerateRequest,
  SkeletonGenerateResponse,
  SkeletonReadResponse,
  SkeletonTocData,
  SkeletonModule,
  SkeletonChapter,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Read user-supplied DeepSeek API key from localStorage. */
function _getApiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem("dr-api-key") ?? "";
  } catch {
    return "";
  }
}

// ====================================================================
// Generic fetch helper
// ====================================================================

async function _fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = _getApiKey();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> ?? {}),
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${init?.method ?? "GET"} ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

// ====================================================================
// Book listing
// ====================================================================

/** List all available books (scanning data/raw/sources/). */
export async function fetchBooks(): Promise<BookMeta[]> {
  return _fetch<BookMeta[]>("/api/books");
}

/** Get metadata for a single book. */
export async function fetchBookMeta(bookName: string): Promise<BookMeta> {
  return _fetch<BookMeta>(`/api/books/${encodeURIComponent(bookName)}`);
}

/** Get indexing progress for a book. */
export async function fetchIndexingStatus(bookName: string): Promise<{ status: string; indexed: number; total: number }> {
  return _fetch(`/api/books/${encodeURIComponent(bookName)}/indexing-status`);
}

// ====================================================================
// Chapters
// ====================================================================

/** List chapters for a book (from raw/ .md file scan). */
export async function fetchChapters(bookName: string): Promise<ChapterRef[]> {
  return _fetch<ChapterRef[]>(
    `/api/books/${encodeURIComponent(bookName)}/chapters`
  );
}

/** Get a single chapter's content. */
export async function fetchChapterContent(
  bookName: string,
  chapterPath: string
): Promise<{ title: string; content: string }> {
  return _fetch(
    `/api/books/${encodeURIComponent(bookName)}/chapters/${encodeURIComponent(chapterPath)}`
  );
}

// ====================================================================
// Chat — stateless SSE streaming
// ====================================================================

/** Stream an immersive action (explain / associate) via SSE.
 *
 * Usage:
 *   const reader = streamChatAction("deep-work", "explain", "selected text");
 *   for await (const chunk of reader) {
 *     console.log(chunk.token ?? chunk.done);
 *   }
 */
export async function* streamChatAction(
  actionType: ChatActionType,
  context: string,
  bookName: string = "",
  chapterId: string = "",
): AsyncGenerator<{ token?: string; done?: boolean; type?: string }, void, undefined> {
  try {
  const apiKey = _getApiKey();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${BASE_URL}/api/chat/action`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action_type: actionType, context, book_name: bookName, chapter_id: chapterId }),
  });

  if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(`Chat action failed (${res.status}): ${errorBody}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw);
          // Unified SSE protocol → backward-compat shape
          if (event.type === "chunk" && typeof event.data === "string") {
            yield { token: event.data, type: "chunk" };
          } else if (event.type === "error") {
            yield { token: event.message ?? "未知错误", type: "error" };
          } else if (event.type === "done") {
            yield { done: true, type: "done" };
          }
          // Legacy fallback: { token, done } (for smooth rollout)
          else if (event.token !== undefined) {
            yield { token: String(event.token) };
          } else if (event.done !== undefined) {
            yield { done: !!event.done };
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { token: `❌ 系统异常：${message}`, type: "error" };
  } finally {
    yield { done: true, type: "done" };
    return;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Socratic Chat — SSE streaming with profile + chapter context
// ═══════════════════════════════════════════════════════════════════

/** Stream a Socratic conversation turn via SSE.
 *
 * Sends user message, chapter_path, and chat_history to the backend.
 * The backend injects profile.json and chapter file content into the prompt.
 */
export async function* streamSocraticChat(
  bookName: string,
  message: string,
  chapterPath: string = "",
  chatHistory: Array<{ role: string; content: string }> = [],
): AsyncGenerator<{ token?: string; done?: boolean; type?: string }, void, undefined> {
  try {
    const apiKey = _getApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    const res = await fetch(`${BASE_URL}/api/chat/socratic`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        book_name: bookName,
        message,
        chapter_path: chapterPath,
        chat_history: chatHistory,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "");
      throw new Error(`Socratic chat failed (${res.status}): ${errorBody}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const event = JSON.parse(raw);
            // Unified SSE protocol → backward-compat shape
            if (event.type === "chunk" && typeof event.data === "string") {
              yield { token: event.data, type: "chunk" };
            } else if (event.type === "error") {
              yield { token: event.message ?? "未知错误", type: "error" };
            } else if (event.type === "done") {
              yield { done: true, type: "done" };
            }
            // Legacy fallback
            else if (event.token !== undefined) {
              yield { token: String(event.token) };
            } else if (event.done !== undefined) {
              yield { done: !!event.done };
            }
          } catch {
            // skip unparseable lines
          }
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { token: `❌ 系统异常：${message}`, type: "error" };
  } finally {
    yield { done: true, type: "done" };
    return;
  }
}

// ====================================================================
// Dictionary search
// ====================================================================

/** Search the book's wiki and raw files via ripgrep + LLM. */
export async function dictionaryLookup(
  bookName: string,
  query: string
): Promise<DictionaryCard> {
  return _fetch<DictionaryCard>("/api/dictionary", {
    method: "POST",
    body: JSON.stringify({ book_name: bookName, query }),
  });
}

// ====================================================================
// Notes — pure file I/O
// ====================================================================

/** Save a note to data/wiki/<book>/notes/<id>.md. */
export async function saveUserNote(
  bookName: string,
  quote: string,
  content: string
): Promise<NoteCreateResponse> {
  return _fetch<NoteCreateResponse>("/api/notes", {
    method: "POST",
    body: JSON.stringify({ book_name: bookName, quote, content } satisfies NoteCreateRequest),
  });
}

/** List all notes for a book. */
export async function listNotes(bookName: string): Promise<NoteListItem[]> {
  return _fetch<NoteListItem[]>(
    `/api/notes?book_name=${encodeURIComponent(bookName)}`
  );
}

/** Delete a note by ID. */
export async function deleteNote(
  bookName: string,
  noteId: string
): Promise<{ deleted: boolean }> {
  return _fetch<{ deleted: boolean }>("/api/notes", {
    method: "DELETE",
    body: JSON.stringify({ book_name: bookName, note_id: noteId } satisfies NoteDeleteRequest),
  });
}

// ====================================================================
// Learning Profile
// ====================================================================

/** Read persisted .profile.json. */
export async function fetchProfile(
  bookName: string
): Promise<LearningProfile> {
  return _fetch<LearningProfile>(
    `/api/profile/${encodeURIComponent(bookName)}`
  );
}

/** Delete a profile. */
export async function deleteProfile(
  bookName: string
): Promise<{ deleted: boolean }> {
  return _fetch<{ deleted: boolean }>(
    `/api/profile/${encodeURIComponent(bookName)}`,
    { method: "DELETE" }
  );
}

/** Trigger chapter-level episodic memory flush (Rule B). */
export async function flushChapter(
  bookName: string,
  chapterId: string,
  chapterSummary?: string
): Promise<{ status: string; chapter_id: string; has_update: boolean }> {
  return _fetch<{ status: string; chapter_id: string; has_update: boolean }>(
    "/api/profile/flush_chapter",
    {
      method: "POST",
      body: JSON.stringify({
        book_name: bookName,
        chapter_id: chapterId,
        chapter_summary: chapterSummary ?? "",
      }),
    }
  );
}

/** Stream profile extraction (ice-breaking dialogue). */
export async function* streamProfileExtraction(
  bookName: string,
  chatContext: Array<{ role: "user" | "assistant"; content: string }>
): AsyncGenerator<
  { token?: string; event?: string; is_ready?: boolean; done?: boolean; type?: string },
  void,
  undefined
> {
  const res = await fetch(`${BASE_URL}/api/profile/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      book_name: bookName,
      chat_context: chatContext,
    } satisfies ProfileExtractRequest),
  });

  if (!res.ok) throw new Error(`Profile extraction failed (${res.status})`);

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw);
          // Unified SSE protocol → backward-compat shape
          if (event.type === "chunk" && typeof event.data === "string") {
            yield { token: event.data, type: "chunk" };
          } else if (event.type === "error") {
            yield { token: event.message ?? "未知错误", type: "error" };
          } else if (event.type === "done") {
            yield { done: true, type: "done" };
          } else if (event.type === "event") {
            yield { event: event.event_name, is_ready: event.data?.is_ready ?? false, type: "event" };
          }
          // Legacy fallback
          else if (event.token !== undefined) {
            yield { token: String(event.token) };
          } else if (event.event !== undefined) {
            yield { event: event.event, is_ready: event.is_ready ?? false };
          }
        } catch {
          // skip unparseable lines
        }
      }
    }
  }
}

// ====================================================================
// Chat Sessions — file-based JSON persistence
// ====================================================================

export interface ChatSessionMeta {
  session_id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export async function listChatSessions(bookName: string): Promise<ChatSessionMeta[]> {
  return _fetch<ChatSessionMeta[]>(
    `/api/chat/sessions/${encodeURIComponent(bookName)}`
  );
}

export async function readChatSession(
  bookName: string,
  sessionId: string
): Promise<{ session_id: string; title: string; messages: Array<{ role: string; content: string }> }> {
  return _fetch(
    `/api/chat/sessions/${encodeURIComponent(bookName)}/${encodeURIComponent(sessionId)}`
  );
}

export async function createChatSession(bookName: string): Promise<{ session_id: string; title: string }> {
  return _fetch(`/api/chat/sessions/${encodeURIComponent(bookName)}`, { method: "POST" });
}

export async function deleteChatSession(bookName: string, sessionId: string): Promise<{ deleted: boolean }> {
  return _fetch(
    `/api/chat/sessions/${encodeURIComponent(bookName)}/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

export async function appendChatMessage(
  bookName: string,
  sessionId: string,
  role: string,
  content: string
): Promise<void> {
  await _fetch(
    `/api/chat/sessions/${encodeURIComponent(bookName)}/${encodeURIComponent(sessionId)}/append`,
    {
      method: "POST",
      body: JSON.stringify({ book_name: bookName, session_id: sessionId, role, content }),
    }
  );
}

/** Update the title of a chat session on the backend. */
export async function updateSessionTitle(
  bookName: string,
  sessionId: string,
  title: string
): Promise<void> {
  await _fetch(
    `/api/chat/sessions/${encodeURIComponent(bookName)}/${encodeURIComponent(sessionId)}/title`,
    {
      method: "PUT",
      body: JSON.stringify({ title }),
    }
  );
}

/** Generate a personalized dynamic TOC (four-level strategy matrix). */
export async function generateSkeleton(
  bookName: string
): Promise<SkeletonGenerateResponse> {
  return _fetch<SkeletonGenerateResponse>("/api/skeleton/generate", {
    method: "POST",
    body: JSON.stringify({ book_name: bookName }),
  });
}

/** Read dynamic TOC as structured JSON. Returns null if not yet generated (404). */
export async function fetchDynamicToc(
  bookName: string
): Promise<SkeletonReadResponse | null> {
  try {
    return await _fetch<SkeletonReadResponse>(
      `/api/skeleton/${encodeURIComponent(bookName)}`
    );
  } catch (e: unknown) {
    // 404 means skeleton hasn't been generated yet — safe "no data" state
    if (e instanceof Error && (e.message.includes("404") || e.message.toLowerCase().includes("not found"))) {
      return null;
    }
    // Real errors (network, 500, etc.) propagate normally
    throw e;
  }
}

// ── Profile Converge (Multi-round Socratic) ──

export interface ConvergeNextResponse {
  is_converged: boolean;
  diagnosis_conclusion: string;
  question: string;
  options: Record<string, string>;
}

export interface ConvergeHistoryItem {
  question: string;
  selected: string;
}

/** Save baseline intake form (Task 2). */
export async function convergeSaveBaseline(
  bookName: string,
  data: {
    profession: string;
    knowledge_level: string;
    pain_point: string;
    daily_minutes: number;
    planned_days: number;
  }
): Promise<{ status: string; profile: Record<string, unknown> }> {
  return _fetch<{ status: string; profile: Record<string, unknown> }>(
    "/api/profile/converge/save_baseline",
    {
      method: "POST",
      body: JSON.stringify({
        book_name: bookName,
        profession: data.profession,
        knowledge_level: data.knowledge_level,
        pain_point: data.pain_point,
        daily_minutes: data.daily_minutes,
        planned_days: data.planned_days,
      }),
    }
  );
}

/** Get next Socratic question or convergence signal (Task 3). */
export async function convergeNext(
  bookName: string,
  roundNum: number,
  profession: string,
  knowledgeLevel: string,
  painPoint: string,
  history: ConvergeHistoryItem[],
  freeText?: string
): Promise<ConvergeNextResponse> {
  return _fetch<ConvergeNextResponse>("/api/profile/converge/next", {
    method: "POST",
    body: JSON.stringify({
      book_name: bookName,
      round_num: roundNum,
      profession,
      knowledge_level: knowledgeLevel,
      pain_point: painPoint,
      history,
      free_text: freeText ?? "",
    }),
  });
}

/** Save final converged profile (Task 3). */
export async function convergeSaveFinal(
  bookName: string,
  data: {
    profession: string;
    knowledge_level: string;
    pain_point: string;
    learning_preference: string;
    daily_minutes: number;
    planned_days: number;
    diagnosis_conclusion: string;
    cognitive_gaps: string[];
    difficulty_hint: string;
    convergence_history: ConvergeHistoryItem[];
  }
): Promise<{ status: string; profile: Record<string, unknown> }> {
  return _fetch<{ status: string; profile: Record<string, unknown> }>(
    "/api/profile/converge/save",
    {
      method: "POST",
      body: JSON.stringify({
        book_name: bookName,
        profession: data.profession,
        knowledge_level: data.knowledge_level,
        pain_point: data.pain_point,
        learning_preference: data.learning_preference,
        daily_minutes: data.daily_minutes,
        planned_days: data.planned_days,
        diagnosis_conclusion: data.diagnosis_conclusion,
        cognitive_gaps: data.cognitive_gaps,
        difficulty_hint: data.difficulty_hint,
        convergence_history: data.convergence_history,
      }),
    }
  );
}

// ====================================================================
// Knowledge Graph
// ====================================================================

/** Fetch graph.json from data/wiki/<book_name>/graph.json. */
export async function fetchGraphData(
  bookName: string
): Promise<GraphExportRes> {
  return _fetch<GraphExportRes>(
    `/api/graph/${encodeURIComponent(bookName)}`
  );
}

// ====================================================================
// Learning Profile — save (wizard form)
// ====================================================================

/** Create or update a learning profile from wizard form data. */
export async function saveProfile(
  bookName: string,
  data: {
    reading_mode: string;
    knowledge_baseline: string;
    pain_point: string;
    cognitive_preference: string;
    time_budget_minutes: number;
  }
): Promise<{ status: string; book_name: string }> {
  return _fetch(`/api/profile/${encodeURIComponent(bookName)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ====================================================================
// Pipeline
// ====================================================================

/** Read .todo.json pipeline progress. */
export async function fetchPipelineStatus(
  bookName: string
): Promise<PipelineStatus> {
  return _fetch<PipelineStatus>(
    `/api/pipeline/status?book_name=${encodeURIComponent(bookName)}`
  );
}

/** Trigger pipeline processing (background task). */
export async function startPipeline(
  bookName: string
): Promise<{ status: string; book_name: string }> {
  return _fetch<{ status: string; book_name: string }>(
    `/api/pipeline/start?book_name=${encodeURIComponent(bookName)}`,
    { method: "POST" }
  );
}

// ====================================================================
// Upload — base64 JSON file import
// ====================================================================

/** Upload a book file (PDF/EPUB/TXT) encoded as base64, triggers document processing. */
export async function uploadBook(
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ status: string; book_title: string; safe_title: string; chapter_count: number }> {
  // Read file as base64
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data:xxx;base64, prefix
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    reader.readAsDataURL(file);
  });

  return _fetch("/api/upload", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, data }),
  });
}

// ====================================================================
// Book CRUD
// ====================================================================

/** Delete a book (raw + wiki directories). */
export async function deleteBook(bookName: string): Promise<{ deleted: boolean }> {
  return _fetch(`/api/books/${encodeURIComponent(bookName)}`, { method: "DELETE" });
}

/** Rename a book or change its cover. */
export async function updateBook(
  bookName: string,
  updates: { new_name?: string; cover_url?: string }
): Promise<{ updated: boolean; book_name: string }> {
  return _fetch(`/api/books/${encodeURIComponent(bookName)}`, {
    method: "PUT",
    body: JSON.stringify({
      new_name: updates.new_name ?? "",
      cover_url: updates.cover_url ?? "",
    }),
  });
}


// ====================================================================
// Quiz — chapter gatekeeper test
// ====================================================================

export interface QuizQuestion {
  question: string;
  options: Record<string, string>;
  answer: string;
  explanation: string;
  skipped?: boolean;
  reason?: string;
}

export interface QuizResponse {
  status: string;
  questions: QuizQuestion[];
  skipped?: boolean;
  reason?: string;
}

export async function fetchQuizQuestions(
  bookName: string,
  chapterPath: string,
  chapterTitle: string = "",
): Promise<QuizResponse> {
  const apiKey = _getApiKey();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(`${BASE_URL}/api/quiz/generate_chapter_test`, {
    method: "POST",
    headers,
    body: JSON.stringify({ book_name: bookName, chapter_path: chapterPath, chapter_title: chapterTitle }),
  });
  if (!res.ok) {
    throw new Error(`Quiz generation failed (${res.status})`);
  }
  const data = await res.json();
  // Detect skipped: either from backend's status or from a skipped dict in questions
  const questions: QuizQuestion[] = data.questions ?? [];
  if (questions.length === 1 && questions[0]?.skipped) {
    return { status: "skipped", questions: [], skipped: true, reason: questions[0].reason ?? "" };
  }
  return { status: "ok", questions };
}
