# DeepRead-v2 — 项目开发总结

> 最后更新：2025-07-11
> 项目路径：`D:\DeepRead-v2`

---

## 一、项目概览

**DeepRead-v2** 是一个 AI 深度阅读助手，采用「文件系统即数据库」架构。前端 Next.js 15 + 后端 FastAPI + DeepSeek LLM。无传统数据库依赖，所有状态（书籍、章节、笔记、画像、骨架、图谱）以 Markdown / JSON 文件存储在 `data/` 下。

- **前端端口**：`localhost:3000` (Next.js dev)
- **后端端口**：`localhost:8000` (uvicorn with auto-reload)
- **LLM**：DeepSeek API (`deepseek-chat`) via `DEEPSEEK_API_KEY`
- **书籍数据**：`系统论——系统科学哲学`（魏宏森、曾国屏著），已拆分为 124 个 Markdown 章节

---

## 二、项目结构

```
DeepRead-v2/
├── app/                          # 前端 (Next.js 15 + React 18)
│   ├── app/
│   │   ├── page.tsx              # 首页（跳转 /books）
│   │   ├── layout.tsx            # 根布局
│   │   ├── globals.css           # 全局样式
│   │   ├── books/
│   │   │   └── page.tsx          # 书架页面（grid + upload + CRUD）
│   │   ├── read/
│   │   │   └── [bookName]/
│   │   │       └── page.tsx      # 阅读器主页（核心路由）
│   │   └── components/
│   │       ├── book/             # GraphModal.tsx, KnowledgeGraphViewer.tsx
│   │       ├── chat/             # ChatPanel.tsx (苏格拉底对话)
│   │       ├── layout/           # TopBar.tsx, SettingsDialog.tsx, ProfileDialog.tsx
│   │       ├── nav/              # TocDrawer.tsx (目录侧边栏)
│   │       ├── profile/          # ProfileWizard.tsx, ProfileWizardModal.tsx
│   │       └── reader/           # ReaderView, QuizModal, BottomNav, SelectionToolbar, InnerReaderHeader
│   ├── lib/
│   │   ├── api_client.ts         # 全部 31 个 API 函数（含 SSE streaming）
│   │   ├── types.ts              # 全部 TypeScript 类型定义
│   │   └── stores/               # Zustand 状态管理
│   │       ├── readerStore.ts    # 阅读器全局状态
│   │       ├── chatStore.ts      # 聊天面板状态
│   │       ├── graphStore.ts     # 知识图谱状态
│   │       └── noteStore.ts      # 笔记状态
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.js
│
├── backend/                      # 后端 (FastAPI + uvicorn)
│   ├── app/
│   │   ├── main.py               # FastAPI 入口（含 load_dotenv）
│   │   ├── master_router.py      # LLM 路由：骨架、对话、Quiz、Profile、Converge
│   │   ├── resource_router.py    # 资源路由：书籍 CRUD、章节、图谱、索引
│   │   ├── core/                 # (空 — 预留)
│   │   └── services/             # 业务逻辑层
│   │       ├── skeleton_service.py     # 动态目录生成（Architect Agent）
│   │       ├── profile_service.py      # 学习画像管理（含 Converge 诊断）
│   │       ├── indexer_service.py      # 章节索引（embedding + summary）
│   │       ├── quiz_service.py         # 章节测试 MCQ 生成
│   │       ├── chat_service.py         # 苏格拉底对话 / 解释 / 联想
│   │       ├── chat_session_service.py # 对话历史管理
│   │       ├── note_service.py         # 笔记 CRUD
│   │       ├── document_processor.py   # 文档解析（PDF/EPUB/DOCX/TXT→MD）
│   │       ├── book_pipeline.py        # 全书处理流水线
│   │       ├── rg_searcher.py          # ripgrep 文本搜索
│   │       └── prompts.py              # LLM Prompt 模板
│   ├── .env                    # DeepSeek API Key（不提交 Git）
│   └── requirements.txt
│
├── data/                         # 数据存储（文件系统即数据库）
│   ├── raw/
│   │   └── sources/
│   │       └── 系统论_系统科学哲学/
│   │           ├── 0000_版权页.md
│   │           ├── 0001_目录.md
│   │           ├── ...
│   │           └── 0124_...md   (共 124 章节)
│   └── wiki/
│       └── {book_name}/
│           ├── .meta.json           # 索引进度
│           ├── chapters_index.json  # 章节索引（summary + tags）
│           ├── dynamic_toc.json     # 骨架/动态目录
│           ├── .profile.json        # 学习画像
│           ├── graph.json           # 知识图谱
│           ├── notes/               # 用户笔记
│           └── chats/               # 对话历史
│
└── docker-compose.yml
```

---

## 三、DATA_ROOT 路径校准（⚠️ 重要）

项目中每个 Python 模块用 `Path(__file__).resolve().parent...parent / "data"` 来定位 `data/` 目录。由于文件层级不同，`parent` 的数量必须准确对应。

### 已修复的完整清单（2025-07-11）

| 文件 | 定位 | 需要 parent 数 | 指向 |
|------|------|---------------|------|
| `backend/app/resource_router.py:24` | `app/` → 项目根 | **3** (`.parent.parent.parent`) | `D:\DeepRead-v2\data` |
| `backend/app/services/skeleton_service.py:13` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |
| `backend/app/services/profile_service.py:13` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |
| `backend/app/services/quiz_service.py:15` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |
| `backend/app/services/chat_session_service.py:12` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |
| `backend/app/services/note_service.py:28` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |
| `backend/app/services/rg_searcher.py:18` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |
| `backend/app/services/indexer_service.py:16` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |
| `backend/app/services/indexer_service.py:180` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |
| `backend/app/services/book_pipeline.py:17` | `app/services/` → 项目根 | **4** | `D:\DeepRead-v2\data` |

**修复前的症状**：一部分服务指向 `backend\data`（空目录），另一部分指向 `D:\DeepRead-v2\data`（有数据），导致前端显示"书架空空"或 API 404。**现在所有路径已统一对齐。**

### 前端 API Base URL

`app/lib/api_client.ts:30`：`BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000"`

使用 `127.0.0.1` 而非 `localhost` 以避免 Windows IPv6 解析问题。

---

## 四、后端 API 完整清单

### Router: `main.py`（无前缀）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/` | 根健康检查 |
| GET | `/health` | 健康状态 |

### Router: `master_router.py`（前缀 `/api`，共 22 条路由）

| 方法 | 路径 | 功能 |
|------|------|------|
| **POST** | `/api/chat/action` | SSE stream — 解释/联想（双模式） |
| **POST** | `/api/chat/socratic` | SSE stream — 苏格拉底对话 |
| POST | `/api/chat/answer` | Quiz 答案处理 |
| POST | `/api/converge/start` | 比喻发现对话 |
| POST | `/api/notes` | 创建笔记 |
| GET | `/api/notes` | 列出笔记 |
| DELETE | `/api/notes` | 删除笔记 |
| POST | `/api/profile/extract` | SSE stream — 画像提取 |
| GET | `/api/profile/{book_name}` | 读取画像 |
| DELETE | `/api/profile/{book_name}` | 删除画像 |
| PUT | `/api/profile/{book_name}` | 直接写入画像 |
| POST | `/api/profile/flush_chapter` | 强制写入章节记忆 |
| POST | `/api/profile/converge/save_baseline` | 保存基线表单 |
| POST | `/api/profile/converge/next` | 单轮苏格拉底问题 |
| POST | `/api/profile/converge/save` | 保存完整诊断 |
| **POST** | `/api/skeleton/generate` | **生成动态目录（骨架）** |
| GET | `/api/skeleton/{book_name}` | 读取骨架 JSON |
| POST | `/api/dictionary` | 术语查词（ripgrep + LLM） |
| GET | `/api/chat/sessions/{book_name}` | 列出对话历史 |
| GET | `/api/chat/sessions/{book_name}/{session_id}` | 读取会话 |
| POST | `/api/chat/sessions/{book_name}` | 创建会话 |
| DELETE | `/api/chat/sessions/{book_name}/{session_id}` | 删除会话 |
| POST | `/api/chat/sessions/{book_name}/{session_id}/append` | 追加消息 |
| POST | `/api/quiz/generate_chapter_test` | 生成章节 MCQ 测试 |

### Router: `resource_router.py`（前缀 `/api`，共 12 条路由）

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/books` | 列出所有书籍 |
| GET | `/api/books/{book_name}` | 单本书元数据 |
| PUT | `/api/books/{book_name}` | 重命名/换封面 |
| DELETE | `/api/books/{book_name}` | 安全删除书籍 |
| GET | `/api/books/{book_name}/indexing-status` | **索引进度（前端轮询）** |
| POST | `/api/books/{book_name}/build_index` | **强制重建索引（后台任务）** |
| POST | `/api/pipeline/start` | 触发全书处理流水线 |
| GET | `/api/pipeline/status` | 流水线进度 |
| GET | `/api/books/{book_name}/chapters` | 列出章节（含摘要标签） |
| GET | `/api/books/{book_name}/chapters/{chapter_path:path}` | 读取章节 Markdown |
| **GET** | `/api/graph/{book_name}` | **知识图谱数据 (graph.json)** |
| POST | `/api/upload` | 上传书籍（base64） |

---

## 五、前端功能模块

### 1. 书架页面 (`/books`)

- 网格展示所有书籍（封面 + 标题 + 章节数）
- 上传（PDF/EPUB/DOCX/TXT/MD/HTML/TEX）
- 重命名、删除、换封面
- 点击书籍进入阅读器

### 2. 阅读器页面 (`/read/[bookName]`) — 核心

| 子组件 | 功能 |
|--------|------|
| **TopBar** | 书籍标题 + 设置 + 画像入口 |
| **TocDrawer** | 目录侧边栏（含骨架策略叠加 + 索引进度轮询） |
| **ReaderView** | Markdown 正文渲染 |
| **ChatPanel** | 苏格拉底 AI 对话（含历史管理） |
| **GraphModal** | 知识图谱可视化 |
| **QuizModal** | 章节 MCQ 测试（精读模式守门人） |
| **ProfileWizardModal** | 多阶段学习画像诊断 |
| **BottomNav** | 章节导航（← 前/后 →） |
| **SelectionToolbar** | 划词操作（解释/联想/笔记） |
| **InnerReaderHeader** | 章节标题 + 主题切换 |

### 3. 关键交互流程

```
上传书籍 → 文档解析 → build_index（后台索引）
    ↓
阅读器加载 → fetchBookMeta + fetchChapters → 显示目录
    ↓
首次使用 → ProfileWizard（Baseline→Socratic→Preference）
    ↓
画像完成 → generateSkeleton（Architect Agent 生成四级策略矩阵）
    ↓
TocDrawer 显示骨架叠加：精读🔴/速读/选读/跳过⚪
    ↓
精读章节 → QuizModal 关卡测试（≥80%通过）
    ↓
对话 → ChatPanel（苏格拉底式提问）
    ↓
图谱 → GraphModal（Canvas 力导向图，可点节点导航）
```

### 4. 轮询机制

| 组件 | API | 间隔 | 触发条件 |
|------|-----|------|---------|
| TocDrawer | `fetchIndexingStatus` | 2s | `indexingStatus === "processing"` |
| KnowledgeGraphViewer | `fetchPipelineStatus` | 2s | 流水线运行中 |

### 5. SSE 流式响应

三个接口使用 SSE streaming：
- `streamSocraticChat` — 苏格拉底对话
- `streamChatAction` — 解释/联想
- `streamProfileExtraction` — 画像提取

前端通过 `AsyncGenerator` 模式逐 token 消费，实时渲染到 ChatPanel。

---

## 六、核心功能：定制骨架（Skeleton / Dynamic TOC）

### 什么是骨架

骨架 = 四级策略阅读矩阵。Architect Agent（LLM）根据用户学习画像 + 原书完整目录，将每个章节归类至：

1. **精读** (intensive) — 核心内容，需 Quiz 测试
2. **速读** (speed) — 相关背景知识
3. **选读** (optional) — 扩展材料
4. **跳过** (skip) — 与学习目标无关

输出格式：`dynamic_toc.json` → `{ modules: [...], archived_chapters: [...] }`，每项含 `original_title`, `file_path`, `recommended_time`, `difficulty_level`, `why_this_matters`。

### 当前状态
-**后端**：skeleton_service.py（DATA_ROOT 已修复）。调用 deepseek-chat 生成 TOC。

-**前端**：TocDrawer.tsx 从 /api/skeleton/{book_name} 获取骨架并叠加。

-**⚠️ 前置依赖严格要求**：generate_skeleton() 的成功执行，必须依赖于两个文件同时存在：

1.**wiki/{book_name}/.profile.json（用户画像诊断完毕）**

2.**wiki/{book_name}/chapters_index.json（后台索引任务 build_index 必须 100% 完成，提供所有章节的 summary）**
(开发禁令：严禁在未完成知识索引构建的情况下，强行调试骨架生成逻辑，否则极易引发 LLM 幻觉或执行失败。)

---

## 七、核心功能：知识图谱（Knowledge Graph）

### 实现位置

- **后端**：`GET /api/graph/{book_name}` → 返回 `graph.json`（nodes + edges）
- **前端**：`KnowledgeGraphViewer.tsx` — Canvas 力导向图（自定义物理引擎）

### 图谱特性

- 节点类型：概念(concept)、术语(term)、人物(person)、事件(event)
- 节点大小 ∝ 度数（连接数）
- 边权重 → 粗细 + 透明度
- 交互：悬停高亮邻居、点击聚焦 2.5x 变焦 + 知识卡片（显示关联章节摘要）
- 知识卡片内可点击「浏览原文」直接跳转到 reading 页面
- 支持缩放（+/-/重置）

### 图谱生成

- 可通过 Swagger：`POST /api/books/{book_name}/build_index`（后台任务）
- 或通过 `KnowledgeGraphViewer` 空状态 → 点击「开始构建」→ `startPipeline` → 轮询进度
- 生成逻辑在 `indexer_service.py` 的 `build_book_index()` 中

### 当前状态

- API 端点 `GET /api/graph/{book_name}` 已定义，但 `data/wiki/系统论_系统科学哲学/graph.json` 尚未生成
- 需要在 Swagger 手动调用 `POST /api/books/系统论_系统科学哲学/build_index` 触发索引构建
- **待测试**：完整图谱生成 → Canvas 渲染 → 节点交互 → 章节导航

---

## 八、核心功能：AI 精读模式

### 精读模式入口

标签栏切换 `immersive`（沉浸） ↔ `intensive`（精读）。精读模式触发：

1. **章节课前 Quiz**：进入精读章节时弹出 5 道 MCQ，≥80% 通过方可阅读
2. **苏格拉底对话**：ChatPanel 的 `streamSocraticChat` 带画像上下文，围绕当前章节展开提问式教学
3. **划词操作**：选择文字 → 弹出解释/联想/笔记选项（SelectionToolbar）
4. **术语查词**：`dictionary_lookup()` → ripgrep 全文搜索 + LLM 解释

### 守门人 Quiz 逻辑

```
用户切换章节
  → 检查 readingMode（是否 intensive）
  → 检查 skeletonToc 策略（是否精读）
  → 如果是精读 + intensive → fetchQuizQuestions
  → QuizModal 弹出
    → 通过 → goToChapter → 显示内容
    → 失败 → 注入 weakness 报告到 ChatPanel → pendingChapter = null
```

### 待测试项

- 精读模式完整流程（Img→Quiz→通过→阅读→对话）
- Quiz 失败后的 remediation（weakness report 是否正确注入）
- 苏格拉底对话的画像注入效果（是否真的做到了个性化）
- 与骨架策略的联动（精读标记的章节是否被正确拦截）

---

## 九、环境配置

### 后端 `.env`（`backend/.env`）

```
DEEPSEEK_API_KEY="sk-cda2dcbe200c44e8bf5786daf6eef481"
DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"
```

`main.py` 已添加 `load_dotenv()`（第 6-7 行）。

### 启动命令

```bash
# 后端（Terminal 1）
cd D:\DeepRead-v2\backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# 前端（Terminal 2）
cd D:\DeepRead-v2\app
npx next dev --port 3000
```

---

## 十、已知问题 & 下一步开发建议

### 已修复（本轮）

- [x] DATA_ROOT 路径全局对齐（8 个文件的 parent 层级修正）
- [x] `main.py` 添加 `load_dotenv()`
- [x] `api_client.ts` BASE_URL 改用 `127.0.0.1`
- [x] `.meta.json` 残留清理
- [x] `force_build_index` 后台任务路径修正

### 待完成

1. **端到端测试骨架生成**：运行 ProfileWizard → generateSkeleton → 验证 dynamic_toc.json → 前端 TocDrawer 叠加显示
2. **端到端测试知识图谱**：调用 build_index → 验证 graph.json 生成 → 前端 Canvas 渲染 → 节点交互
3. **精读模式全流程测试**：切换 intensive → 进入精读章节 → Quiz 守门 → 通过/失败 → 苏格拉底对话
4. **骨架与 Quiz 联动验证**：骨架标记为「精读」的章节是否正确触发 Quiz，标记为「跳过」的章节是否直接放行
5. **清理 `backend/data/` 冗余目录**：`D:\DeepRead-v2\backend\data\` 下有旧数据残留（旧 DATA_ROOT 写入的），可在确认功能正常后删除
6. **ProfileWizard 调试**：Converge 多轮苏格拉底诊断 + 偏好收集 + skeleton 自动生成的完整链路
7. **性能**：章节索引目前 124 章，全量 build_index 用 LLM 生成 summary + tags，耗时不短，可考虑进度实时推送

---

## 十一、开发辅助信息

### 测试 API 的快捷方式

```
# 书架
curl http://127.0.0.1:8000/api/books

# 书籍元数据
curl http://127.0.0.1:8000/api/books/系统论_系统科学哲学

# 章节列表
curl http://127.0.0.1:8000/api/books/系统论_系统科学哲学/chapters

# 索引进度
curl http://127.0.0.1:8000/api/books/系统论_系统科学哲学/indexing-status

# Swagger UI
http://localhost:8000/docs
```

### 关键 TS 类型位置

- `BookMeta`, `ChapterRef`, `SkeletonTocData`, `CoreMemory`, `LearningProfile` — `app/lib/types.ts`
- `QuizQuestion`, `GraphNode`, `GraphEdge` — 同上
- Zustand stores — `app/lib/stores/`
