/** DeepRead-v2 — TypeScript interfaces aligned with backend Pydantic schemas.

 * Every interface here maps 1:1 to the new file-system architecture.
 * No UUID primary keys. No integer IDs. No chunk_index.
 * book_name (string) is the only resource locator.
 */

// ====================================================================
// Book
// ====================================================================

export interface BookMeta {
  book_name: string;        // directory slug under data/raw/sources/
  title: string;
  file_type: string;        // "pdf" | "epub" | "txt" | "md"
  chapter_count: number;
  indexing_status?: string; // "pending" | "processing" | "completed" (default "pending")
}

// ====================================================================
// Chapter (from raw Markdown files)
// ====================================================================

export interface ChapterRef {
  title: string;
  path: string;             // relative path from data/raw/sources/<book_name>/
  order: number;
  parent_title: string | null;
  summary?: string;         // AI-generated chapter summary
  tags?: string[];          // AI-generated chapter tags
  is_indexed?: boolean;      // single-chapter index completion (default false)
}

// ====================================================================
// Chat — stateless SSE streaming
// ====================================================================

export type ChatActionType = "explain" | "associate";

export interface ChatActionRequest {
  action_type: ChatActionType;
  context: string;          // selected text
}

export interface ChatSSEToken {
  token: string;
}

export interface ChatSSEDone {
  done: true;
}

export type ChatSSEEvent = ChatSSEToken | ChatSSEDone;

// ====================================================================
// Note
// ====================================================================

export interface NoteCreateRequest {
  book_name: string;
  quote: string;            // original text being annotated
  content: string;          // user's note
}

export interface NoteCreateResponse {
  note_id: string;
  path: string;
  created_at: string;
}

export interface NoteListItem {
  note_id: string;
  quote: string;
  content: string;
  created_at: string;
  path: string;
}

export interface NoteDeleteRequest {
  book_name: string;
  note_id: string;
}

// ====================================================================
// Learning Profile
// ====================================================================

// ====================================================================
// Learning Profile — Hierarchical v2 (core_memory + episodic_memory)
// ====================================================================

/** Permanent core memory — evolves slowly, ≥2 independent confirmations needed. */
export interface CoreMemory {
  profession: string;
  learning_style: "theory_first" | "story_first";
  cognitive_gaps: string[];
  pain_point: string;
  knowledge_level: string;
  diagnosis: string;
  difficulty_hint: string;
}

/** Per-chapter episodic memory snippet. */
export interface EpisodicChapter {
  status: "已掌握" | "学习中" | "困难";
  key_struggles: string;
  aha_moments: string;
  keywords: string[];
}

export interface LearningProfile {
  schema_version: number;          // 2
  book_name: string;
  core_memory: CoreMemory;
  episodic_memory: Record<string, EpisodicChapter>;
  _flush_counter: number;
  _last_flush_at: string;
  // Transient flat fields (backward compat — exist alongside core_memory)
  profession?: string;
  knowledge_level?: string;
  knowledge_baseline?: string;    // legacy
  pain_point?: string;
  learning_preference?: string;
  cognitive_preference?: string;  // legacy
  daily_minutes?: number;
  planned_days?: number;
  cognitive_gaps?: string[];
  diagnosis_conclusion?: string;
  difficulty_hint?: string;
  time_budget_minutes?: number;
  convergence_history?: Array<{ question: string; selected: string }>;
}

export interface ProfileExtractRequest {
  book_name: string;
  chat_context: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface ProfileReadinessEvent {
  event: "profile_readiness";
  is_ready: boolean;
}

// ====================================================================
// Dynamic Skeleton (TOC) — 四级策略矩阵
// ====================================================================

export interface SkeletonGenerateRequest {
  book_name: string;
}

export interface SkeletonGenerateResponse {
  status: "completed" | "failed";
  path: string;
  toc_data: SkeletonTocData;
  error?: string;
}

export interface SkeletonTocData {
  theme: string;
  modules: SkeletonModule[];
  archived_chapters: SkeletonChapter[];
}

export interface SkeletonModule {
  module_name: string;
  chapters: SkeletonChapter[];
}

export interface SkeletonChapter {
  file_path: string;
  original_title: string;
  strategy: "精读" | "速读" | "选读" | "跳过";
  advice: string;
  _valid?: boolean;
}

export interface SkeletonReadResponse {
  book_name: string;
  toc_data: SkeletonTocData;
}

// ====================================================================
// Knowledge Graph (from graph.json)
// ====================================================================

export interface GraphNode {
  id: string;               // node filename stem (e.g. "concept-熵增定律")
  label: string;             // display name from YAML frontmatter title
  type: string;              // "concept" | "person" | "term" | "event"
  community_id: number;
  size: number;
  x: number;
  y: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphExportRes {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ====================================================================
// Pipeline status (from .todo.json)
// ====================================================================

export interface PipelineStatus {
  status: string;            // "idle" | "processing" | "completed"
  phase: number;             // 0=chunking, 1=analysis, 2=generation, 3=graph
  total_chapters: number;
  completed_chapters: string[];
  total_nodes: number;
  completed_nodes: number[];
  graph_built: boolean;
  started_at: string;
  updated_at: string;
}

// ====================================================================
// Dictionary search (from rg_searcher)
// ====================================================================

export interface DictionaryCard {
  term: string;
  definition: string;
  context: string;
  match_count: number;
  matches?: Array<{ file: string; line: number; snippet: string }>;
}
