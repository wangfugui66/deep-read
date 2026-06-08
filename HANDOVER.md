# DeepRead-v2 技术交接文档

> 生成日期：2026-06-08
> 目标受众：后续接手开发的 AI 编程助手
> 项目路径：`D:\DeepRead-v2`

---

## 一、项目概览

**DeepRead-v2** 是一个 AI 深度阅读助手，采用「文件系统即数据库」零依赖架构。前端 Next.js 15 (App Router) + 后端 FastAPI + DeepSeek LLM。无 MySQL/Redis/SQLite，所有状态以 Markdown / JSON 文件存储在 `data/` 下。

- **前端地址**：`http://localhost:3000` (`npm run dev`)
- **后端地址**：`http://localhost:8000` (`uvicorn app.main:app --reload`)
- **LLM**：DeepSeek API (`deepseek-chat`) via `DEEPSEEK_API_KEY` 环境变量
- **Docker**：`docker compose up` (backend 始终启动；`--profile fullstack` 启动 frontend)

---

## 二、项目目录结构

```
DeepRead-v2/
├── app/                              # Next.js 15 前端 (App Router)
│   ├── app/
│   │   ├── page.tsx                  # / → 重定向至 /books
│   │   ├── layout.tsx                # 根布局, lang="zh-CN"
│   │   ├── globals.css               # Tailwind CSS 4
│   │   ├── books/page.tsx            # 书架页 (CSR) — 书籍网格 + 上传 + CRUD
│   │   ├── read/[bookName]/page.tsx  # 阅读器核心页 (CSR) — 编排所有子组件
│   │   └── components/
│   │       ├── book/                 # GraphModal.tsx, KnowledgeGraphViewer.tsx
│   │       ├── chat/                 # ChatPanel.tsx (SSE 苏格拉底对话)
│   │       ├── layout/               # TopBar, SettingsDialog, ProfileDialog
│   │       ├── nav/                  # TocDrawer.tsx (目录侧边栏)
│   │       ├── profile/              # ProfileWizard.tsx, ProfileWizardModal.tsx
│   │       └── reader/               # ReaderView, QuizModal, BottomNav,
│   │                                  # SelectionToolbar, InnerReaderHeader,
│   │                                  # KnowledgeAnimationModal, TeachAnyButton
│   ├── lib/
│   │   ├── api_client.ts             # 31 个 API 函数 (fetch + SSE streaming)
│   │   ├── api-config.ts             # API_BASE_URL 解析 + TeachAny 辅助
│   │   ├── types.ts                  # TypeScript 类型定义
│   │   └── stores/
│   │       ├── readerStore.ts        # Zustand: 书籍/章节/偏好/测验
│   │       ├── chatStore.ts          # Zustand: 消息/会话
│   │       ├── graphStore.ts         # Zustand: 图谱弹窗/选中节点
│   │       └── noteStore.ts          # Zustand: 笔记 CRUD + 缓存
│   ├── package.json                  # Next 15.3, React 19, Zustand 5, GSAP
│   ├── tsconfig.json                 # strict, ES2017, paths: @/*
│   └── next.config.js                # standalone output, transpile lucide-react
│
├── backend/                          # FastAPI 后端
│   ├── app/
│   │   ├── main.py                   # FastAPI 入口 + CORS + load_dotenv
│   │   ├── master_router.py          # 22+ 条 LLM 路由 (chat, quiz, profile, skeleton, notes, sessions)
│   │   ├── resource_router.py        # 12 条资源路由 (books, chapters, graph, pipeline, upload)
│   │   ├── plugins_router.py         # 4 条插件路由 (TeachAny, Animation)
│   │   ├── core/
│   │   │   └── config.py             # DATA_ROOT = project_root / "data"
│   │   ├── services/
│   │   │   ├── prompts.py            # 全部 LLM System Prompt 模板 (NER, Deconstructor, Architect, Reviewer, Feynman Quiz/Guide, Profiler)
│   │   │   ├── chat_service.py       # SSE 对话 (explain/associate/socratic)
│   │   │   ├── profile_service.py    # 学习画像 (core_memory + episodic_memory v2)
│   │   │   ├── skeleton_service.py   # Architect Agent: 动态目录生成 (四级策略矩阵)
│   │   │   ├── indexer_service.py    # 异步章节索引 (embedding + summary)
│   │   │   ├── quiz_service.py       # Feynman Quiz Agent: 5题 MCQ
│   │   │   ├── note_service.py       # 笔记 CRUD (文件系统)
│   │   │   ├── chat_session_service.py  # 对话历史管理
│   │   │   ├── graph_service.py      # 知识图谱构建 (LLM 驱动)
│   │   │   ├── book_pipeline.py      # 全书流水线编排
│   │   │   ├── document_processor.py # 文档解析 (PDF/EPUB/DOCX/TXT→MD)
│   │   │   ├── rg_searcher.py        # ripgrep 全文搜索
│   │   │   ├── knowledge_animation_service.py  # HyperFrames 动画生成
│   │   │   └── teachany_service.py   # TeachAny 课件生成
│   │   ├── prompts/
│   │   │   └── knowledge_animation.md  # 动画 prompt (SVG 图解 + GSAP 特效)
│   │   └── utils/
│   │       └── file_ops.py           # 原子 JSON 写入 (临时文件+重命名)
│   └── requirements.txt              # FastAPI, openai>=1.50, pymupdf4llm, ebooklib, networkx, etc.
│
├── data/                             # 文件系统即数据库
│   ├── raw/sources/{book}/*.md       # 原始章节文件
│   ├── wiki/{book}/                  # .meta.json, chapters_index.json, dynamic_toc.json,
│   │                                  # .profile.json, graph.json, notes/, chats/
│   └── plugins/                      # 插件缓存 (TeachAny HTML, 动画缓存)
│
├── docker-compose.yml
├── ARCHITECTURE.md
└── README.md
```

---

## 三、全部 API 端点清单

### 3.1 根路由

| 方法 | 路径 | 返回 | 用途 |
|------|------|------|------|
| GET | `/` | JSON | 健康检查 — `{"service":"DeepRead-v2","version":"2.0.0"}` |
| GET | `/health` | JSON | Docker 健康检查 — `{"status":"healthy"}` |

### 3.2 书籍资源 (`resource_router.py`)

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/books` | 列出所有书籍 |
| GET | `/api/books/{book_name}` | 获取单本书元数据 |
| DELETE | `/api/books/{book_name}` | 删除书籍 (raw + wiki) |
| PUT | `/api/books/{book_name}` | 重命名 / 改封面 URL |
| GET | `/api/books/{book_name}/indexing-status` | 索引进度轮询 `{status, indexed, total}` |
| POST | `/api/books/{book_name}/build_index` | 强制重建索引 |
| GET | `/api/books/{book_name}/chapters` | 列出章节 (含策略标签) |
| GET | `/api/books/{book_name}/chapters/{chapter_path}` | 读取原始章节 Markdown 内容 |
| POST | `/api/upload` | base64 文件上传 (PDF/EPUB/TXT/MD/DOCX) |
| GET | `/api/graph/{book_name}` | 知识图谱数据 `{nodes, edges}` |
| GET | `/api/pipeline/status` | 流水线进度 (查询: `book_name`) |
| POST | `/api/pipeline/start` | 启动全书流水线 |

### 3.3 LLM 功能 (`master_router.py`)

| 方法 | 路径 | 类型 | 用途 |
|------|------|------|------|
| POST | `/api/chat/action` | SSE | 解释/联想 沉浸式操作 |
| POST | `/api/chat/socratic` | SSE | 苏格拉底式教学对话 |
| POST | `/api/chat/answer` | JSON | 测验答案处理 |
| POST | `/api/notes` | JSON | 保存笔记 |
| GET | `/api/notes` | JSON | 列出笔记 (查询: `book_name`) |
| DELETE | `/api/notes` | JSON | 删除笔记 (body: `book_name` + `note_id`) |
| POST | `/api/profile/extract` | SSE | 画像提取 (破冰) |
| GET | `/api/profile/{book_name}` | JSON | 读取学习画像 |
| DELETE | `/api/profile/{book_name}` | JSON | 删除画像 |
| PUT | `/api/profile/{book_name}` | JSON | 创建/更新画像 |
| POST | `/api/profile/flush_chapter` | JSON | 章节离开写入情景记忆 |
| POST | `/api/profile/converge/save_baseline` | JSON | 收敛基线保存 |
| POST | `/api/profile/converge/next` | JSON | 下一轮收敛问题 |
| POST | `/api/profile/converge/save` | JSON | 完整收敛画像保存 |
| POST | `/api/skeleton/generate` | JSON | 生成动态目录 |
| GET | `/api/skeleton/{book_name}` | JSON | 读取动态目录 |
| POST | `/api/converge/start` | JSON | 收敛比喻发现 |
| POST | `/api/dictionary` | JSON | 术语搜索 (ripgrep + LLM) |
| GET | `/api/chat/sessions/{book_name}` | JSON | 列出聊天会话 |
| GET | `/api/chat/sessions/{book_name}/{session_id}` | JSON | 读取特定会话 |
| POST | `/api/chat/sessions/{book_name}` | JSON | 创建会话 |
| DELETE | `/api/chat/sessions/{book_name}/{session_id}` | JSON | 删除会话 |
| POST | `/api/chat/sessions/{book_name}/{session_id}/append` | JSON | 追加消息 |
| PUT | `/api/chat/sessions/{book_name}/{session_id}/title` | JSON | 更新会话标题 |
| POST | `/api/quiz/generate_chapter_test` | JSON | 生成章节测验 (5题) |

### 3.4 插件 (`plugins_router.py`)

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/plugins/teachany/generate` | 生成 TeachAny 交互式课件 |
| GET | `/api/plugins/teachany/view/{book_name}/{file_name}` | 提供缓存的课件 HTML |
| POST | `/api/plugins/animation/generate` | 生成 HyperFrames 知识动画 HTML |

---

## 四、前端 API 客户端 (`api_client.ts`) 完整清单

### 书籍 CRUD
- `fetchBooks()` → `GET /api/books`
- `fetchBookMeta(bookName)` → `GET /api/books/{name}`
- `deleteBook(bookName)` → `DELETE /api/books/{name}`
- `updateBook(bookName, updates)` → `PUT /api/books/{name}`
- `uploadBook(file, onProgress)` → `POST /api/upload`

### 索引进度
- `fetchIndexingStatus(bookName)` → `GET /api/books/{name}/indexing-status`

### 章节
- `fetchChapters(bookName)` → `GET /api/books/{name}/chapters`
- `fetchChapterContent(bookName, chapterPath)` → `GET /api/books/{name}/chapters/{path}`

### SSE 流式
- `streamChatAction(actionType, context, bookName, chapterId)` — explain/associate
- `streamSocraticChat(bookName, message, chapterPath, chatHistory)`
- `streamProfileExtraction(bookName, chatContext)`

### 笔记
- `saveUserNote(bookName, quote, content)` → `POST /api/notes`
- `listNotes(bookName)` → `GET /api/notes`
- `deleteNote(bookName, noteId)` → `DELETE /api/notes`

### 画像
- `fetchProfile(bookName)` → `GET /api/profile/{name}`
- `deleteProfile(bookName)` → `DELETE /api/profile/{name}`
- `saveProfile(bookName, data)` → `PUT /api/profile/{name}`
- `flushChapter(bookName, chapterId, chapterSummary)` → `POST /api/profile/flush_chapter`
- `convergeSaveBaseline(bookName, data)` → `POST /api/profile/converge/save_baseline`
- `convergeNext(bookName, ...)` → `POST /api/profile/converge/next`
- `convergeSaveFinal(bookName, data)` → `POST /api/profile/converge/save`

### 聊天会话
- `listChatSessions(bookName)` / `readChatSession` / `createChatSession` / `deleteChatSession` / `appendChatMessage` / `updateSessionTitle`

### 骨架 / 图谱 / 流水线
- `generateSkeleton(bookName)` → `POST /api/skeleton/generate`
- `fetchDynamicToc(bookName)` → `GET /api/skeleton/{name}`
- `fetchGraphData(bookName)` → `GET /api/graph/{name}`
- `fetchPipelineStatus(bookName)` → `GET /api/pipeline/status`
- `startPipeline(bookName)` → `POST /api/pipeline/start`

### 测验 / 字典
- `fetchQuizQuestions(bookName, chapterPath, chapterTitle)` → `POST /api/quiz/generate_chapter_test`
- `dictionaryLookup(bookName, query)` → `POST /api/dictionary`

---

## 五、关键 TypeScript 类型

```typescript
BookMeta = { book_name, title, file_type, chapter_count, indexing_status }
ChapterRef = { title, path, order, parent_title, summary?, tags?, is_indexed? }
ChatActionType = "explain" | "associate"
NoteCreateRequest = { book_name, quote, content }
NoteListItem = { id, quote, content, created_at }
CoreMemory = { profession, learning_style, cognitive_gaps, pain_point, knowledge_level, difficulty_hint }
EpisodicChapter = { status, key_struggles, aha_moments, keywords }
LearningProfile = { schema_version, book_name, core_memory, episodic_memory, ... }
SkeletonTocData = { theme, modules: SkeletonModule[], archived_chapters: SkeletonChapter[] }
SkeletonChapter = { file_path, original_title, strategy: "精读"|"速读"|"选读"|"跳过", advice }
GraphNode = { id, label, type, community_id, size, x, y }
GraphEdge = { source, target, weight }
GraphExportRes = { nodes, edges }
PipelineStatus = { status, phase, total_chapters, completed_chapters[], ... }
DictionaryCard = { term, definition, context, match_count, matches? }
```

---

## 六、每个后端服务一句话职责

| 文件 | 职责 |
|------|------|
| `chat_service.py` | 无状态 SSE 流式对话 (explain / associate / socratic) |
| `profile_service.py` | 分层画像管理 v2 (`core_memory` + `episodic_memory`) + 收敛诊断 |
| `skeleton_service.py` | Architect Agent: 生成四级策略矩阵动态目录 |
| `note_service.py` | 文件系统笔记 CRUD (`data/wiki/{book}/notes/{id}.md`) |
| `chat_session_service.py` | 对话历史 JSON CRUD |
| `indexer_service.py` | 异步 LLM 章节摘要 + 并发限制池 |
| `quiz_service.py` | Feynman Quiz Agent: 5 题个性化 MCQ |
| `graph_service.py` | 全局知识图谱构建 (LLM 提取节点 + 边 + NetworkX) |
| `book_pipeline.py` | 全书处理流水线编排 |
| `document_processor.py` | PDF/EPUB/DOCX/TXT/MD 解析器 |
| `rg_searcher.py` | ripgrep 全文搜索 |
| `knowledge_animation_service.py` | HyperFrames SVG+GSAP 60s 动画生成 |
| `teachany_service.py` | TeachAny 交互式课件 HTML 生成 |
| `prompts.py` | 全部 LLM System Prompt 模板 (NER / Deconstructor / Architect / Reviewer / Feynman Quiz / Feynman Guide / Profiler) |

---

## 七、数据文件格式

### `data/wiki/{book}/chapters_index.json`
```json
[
  {
    "title": "章节标题",
    "path": "0001_目录.md",
    "order": 1,
    "summary": "LLM 生成摘要",
    "tags": ["标签1", "标签2"],
    "is_indexed": true
  }
]
```

### `data/wiki/{book}/dynamic_toc.json`
```json
{
  "theme": "阅读主题",
  "modules": [
    {
      "module_title": "模块名",
      "module_desc": "模块描述",
      "chapters": [
        {
          "file_path": "xxxx.md",
          "original_title": "原标题",
          "strategy": "精读",
          "advice": "阅读指导"
        }
      ]
    }
  ],
  "archived_chapters": []
}
```

### `data/wiki/{book}/.profile.json` (画像 v2)
```json
{
  "schema_version": "2.0.0",
  "book_name": "...",
  "core_memory": {
    "profession": "...",
    "learning_style": "...",
    "cognitive_gaps": [...],
    "pain_point": "...",
    "knowledge_level": "...",
    "diagnosis": "...",
    "difficulty_hint": "beginner|intermediate|expert"
  },
  "episodic_memory": {
    "chapters": {
      "0001_目录.md": {
        "status": "reading",
        "key_struggles": [],
        "aha_moments": [],
        "keywords": []
      }
    }
  }
}
```

### `data/wiki/{book}/graph.json`
```json
{
  "nodes": [
    { "id": "...", "label": "...", "type": "概念", "community_id": 0, "size": 10, "x": 0, "y": 0 }
  ],
  "edges": [
    { "source": "id1", "target": "id2", "weight": 0.8 }
  ]
}
```

---

## 八、Docker Compose

```yaml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    volumes: ["./data:/app/data"]
    environment:
      - DEEPSEEK_API_KEY=${DEEPSEEK_API_KEY}
      - DEEPSEEK_BASE_URL=${DEEPSEEK_BASE_URL:-https://api.deepseek.com/v1}
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]

  frontend:
    build: ./app
    ports: ["3000:3000"]
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:8000
    depends_on:
      backend:
        condition: service_healthy
    profiles: [fullstack]
```

启动：
```bash
docker compose up                  # 仅后端
docker compose --profile fullstack up  # 前端+后端
```

---

## 九、DATA_ROOT 路径校准（已修复）

项目中每个 Python 模块通过 `Path(__file__).resolve().parent...parent / "data"` 定位 `data/`。层级数必须精确：

| 文件 | 所在目录 | 需向上 parent 数 |
|------|---------|-----------------|
| `resource_router.py` | `app/` | 3 |
| `plugins_router.py` | `app/` | 3 |
| `config.py` | `app/core/` | 4 |
| `skeleton_service.py` | `app/services/` | 4 |
| `profile_service.py` | `app/services/` | 4 |
| `indexer_service.py` | `app/services/` | 4 |
| `graph_service.py` | `app/services/` | 4 |
| `knowledge_animation_service.py` | `app/services/` | 4 |
| `teachany_service.py` | `app/services/` | 4 |
| `document_processor.py` | `app/services/` | 4 |

---

## 十、前端 Zustand Store 状态模型

### readerStore
- `currentBook: string | null`
- `currentChapter: ChapterRef | null`
- `theme: "day" | "warm" | "night"`
- `fontSize: number` (14-24)
- `readingMode: "immersive" | "intensive"`
- `quizQuestions: QuizQuestion[]`
- `skeletonData: SkeletonTocData | null`
- `animationStatus: "idle" | "generating" | "ready"`
- `animationHtml: string | null`

### chatStore
- `messages: ChatMessage[]`
- `sessionId: string | null`
- `isLoading: boolean`

### graphStore
- `isModalOpen: boolean`
- `selectedNode: string | null`

### noteStore
- `notes: NoteListItem[]`
- `loading: boolean`
- Actions: `loadNotes(bookName)`, `saveNote(...)`, `deleteNote(...)`

---

## 十一、知识动画子系统 (HyperFrames)

### 后端流程
1. `POST /api/plugins/animation/generate` — 接收 `{book_name, chapter_paths, api_key}`
2. `knowledge_animation_service.py`:
   - 读取 `data/raw/sources/{book_name}/{chapter}.md` 原始章节
   - 拼接 user prompt + system prompt (`prompts/knowledge_animation.md`)
   - 调用 DeepSeek `deepseek-chat` (max_tokens=8192, temperature=0.6)
   - `_extract_clean_html()` 用 `re.search('(?:<!DOCTYPE html>|<html\\b).*?</html>', DOTALL)` 提取纯净 HTML
   - 返回 `{"status":"ok","html":"..."}`

### 前端播放流程
1. `api_client.ts`: `fetchAnimation(bookName, chapterPaths, apiKey)` → POST
2. `page.tsx`: 接收 html → 创建 Blob URL → `setAnimationHtml(...)` → 打开 `KnowledgeAnimationModal`
3. `KnowledgeAnimationModal.tsx`:
   - 动态 import `@hyperframes/player` (Web Component)
   - 用 `document.createElement("hyperframes-player")` 创建播放器 (绕过 TS JSX 类型问题)
   - `setAttribute("src", blobUrl)`, `controls`, `autoplay`, `loop`
   - `key={blobUrl}` 强制 React 重新挂载
   - 容器 `transition-opacity duration-500` + 声明式 `style={{ opacity }}`
   - `min-h-[400px]` 防 CSS collapse
   - `finally` 块兜底 `animationStatus` 不会卡死

### Prompt 当前策略 (`prompts/knowledge_animation.md`)
SVG 图解 + GSAP 特效模式，含 5 条物理防线：
1. 舞台协议 (`data-composition-id="main"`)
2. CSS 防塌陷
3. GSAP CDN 在 stage 内部
4. `paused: true` + 导出 `window.__timelines`
5. 绝对禁止 `tl.play()` / `setTimeout`

视觉：`<svg viewBox="0 0 1920 1080">` + 节点弹跳 (elastic.out) + 连线 stroke-dashoffset + 发光 filter + `#00F0FF` / `#FF0055` 高亮。

---

## 十二、已有书籍数据

```
data/raw/sources/
├── 系统论_系统科学哲学/       # 124 章 (已完成索引)
├── AMonteCarlotreesearch.../  # 部分处理
└── 元启发式算法研究综述_张梦婷/  # 部分处理
```

---

## 十三、环境变量

| 变量 | 用途 | 必须 |
|------|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 是 |
| `DEEPSEEK_BASE_URL` | API 端点 (默认 `https://api.deepseek.com/v1`) | 否 |
| `NEXT_PUBLIC_API_URL` | 前端访问后端的地址 (默认 `http://localhost:8000`) | 否 |

---

## 十四、关键注意事项 (给后续 AI 助手)

1. **绝对不要引入数据库** — 项目核心设计理念是「文件系统即数据库」，所有持久化在 `data/` 下。
2. **`plugins_router.py` 的 `generate_animation` 导入已确认正确** (line 16: `from app.services.knowledge_animation_service import generate_animation`)。
3. **Profile 数据已升级到 v2 架构** (`core_memory` + `episodic_memory`)，保留向后兼容的扁平字段。
4. **动画 prompt 经历了多次迭代** (SVG → Apple Text → SVG 回滚)，当前最终稳定版为 SVG 图解模式 + 5 条物理防线。
5. **`tsc --noEmit` 在每次前端修改后必须零错误通过**。
6. **Python AST parse 在后端修改后必须通过** (`python -c "import ast; ast.parse(...)"`)。
7. **Windows 编码问题**：PowerShell 不支持 `&&` 链式命令，用 `;` 代替。文件 CRLF 警告可忽略。
