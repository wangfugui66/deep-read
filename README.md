# DeepRead-v2

AI 深度阅读助手 — 让每一本书都有一位 AI 导师。

## 概述

DeepRead-v2 是一个基于 LLM 的智能阅读系统。上传一本书，AI 自动建立个性化四级阅读策略（精读 / 速读 / 选读 / 跳过），提供苏格拉底式对话、章节测验、知识图谱和知识沙盘等功能。

**核心理念：文件系统即数据库。** 无需 PostgreSQL、Redis 等外部依赖，所有状态以 Markdown / JSON 文件存放在 `data/` 下，可直接用 Git 版本控制。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Next.js 15 + React 19 + TypeScript 5.8 |
| 状态管理 | Zustand 5 |
| 样式 | Tailwind CSS 4 |
| Markdown 渲染 | react-markdown + remark-gfm |
| 后端 | FastAPI + uvicorn |
| LLM | DeepSeek API (`deepseek-chat`) |
| 文档解析 | PyMuPDF (PDF) + ebooklib (EPUB) + python-docx (DOCX) |
| 文本搜索 | ripgrep |
| 容器化 | Docker Compose |

## 快速开始

### 前置要求

- Python 3.11+
- Node.js 20+
- DeepSeek API Key（[获取](https://platform.deepseek.com/)）
- [ripgrep](https://github.com/BurntSushi/ripgrep)（全文搜索依赖）

### 1. 启动后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # macOS / Linux

pip install -r requirements.txt

# 配置 API Key
echo DEEPSEEK_API_KEY=sk-your-key-here > .env

# 启动 (默认 :8000)
uvicorn app.main:app --reload
```

后端启动后访问 http://localhost:8000/docs 查看 Swagger API 文档。

### 2. 启动前端

```bash
cd app
npm install
npm run dev
```

前端启动后访问 http://localhost:3000。

### 3. Docker 一键启动

```bash
DEEPSEEK_API_KEY=sk-your-key-here docker compose --profile fullstack up
```

> 注意：需要 `--profile fullstack`，因为前端作为可选服务启动。

## 使用流程

```
上传书籍 → 文档解析为 Markdown → 后台构建知识索引
    ↓
首次阅读 → 学习画像诊断（Baseline → Socratic → Preference）
    ↓
Architect Agent 根据画像生成四级阅读策略
    ↓
目录树叠加显示：精读 🔴 / 速读 🟡 / 选读 🔵
    ↓
精读章节 → 通关测验（≥80% 正确率）
    ↓
随时 → 苏格拉底式 AI 对话（划线解释 / 联想 / 自由提问）
    ↓
全局视角 → 力导向知识图谱
```

## 核心功能

### 个性化阅读策略 (Skeleton)

Architect Agent 根据你的学习画像，将全书章节分配为四级策略：

| 策略 | 含义 | 目录表现 |
|------|------|----------|
| 精读 | 核心内容 | 红色 `精读` 标签 + 粗体 |
| 速读 | 背景知识 | 常规样式 |
| 选读 | 扩展材料 | 常规样式 |
| 跳过 | 无关内容 | 自动从目录中隐藏 |

索引完成且画像生成后，目录树会叠加策略标签。点击任意章节即可开始阅读。

### 苏格拉底对话

基于费曼学习法和苏格拉底反诘法的 AI 导师：

- 在阅读器中划选文本，选择「解释」或「联想」
- 在右侧聊天面板自由提问
- SSE 流式响应，逐 token 实时渲染
- 对话历史自动持久化，首次消息自动提取标题

### 章节测验

精读章节读完后：

- AI 生成 4 道单选题 + 1 道开放思考题
- ≥80% 正确率过关，不合格可重试
- 通关后方可进入下一章（精读守门员机制）

### 知识图谱

- 前端 Canvas 力导向图自动布局
- 节点类型：概念 / 术语 / 人物 / 事件
- 悬停高亮邻居，点击聚焦 + 知识卡片
- 可从卡片直接跳转到原文

### 知识沙盘 (TeachAny)

将单节或多节内容提炼为交互式 HTML 微课件：

- **单节粒度**：底部导航栏「知识沙盘」按钮，将当前章节提炼为课件
- **章粒度聚合**：目录树中父级节点右侧 `Layers` 图标，递归收集子章节生成大课件
- **反幻觉守门员**：字数 < 1000 时自动禁用，防止低质量输出
- 生成结果在新标签页以沙盒 HTML 形式打开

### 学习画像诊断

三阶段问卷（Baseline → Socratic → Preference），诊断学习偏好、知识背景和目标，作为骨架生成的前置输入。支持断点续诊。

## 项目结构

```
DeepRead-v2/
├── app/                          # 前端 (Next.js 15)
│   ├── app/
│   │   ├── page.tsx              # 首页 → /books
│   │   ├── books/page.tsx        # 书架（上传、管理书籍）
│   │   ├── read/[bookName]/page.tsx  # 阅读器主页
│   │   └── components/
│   │       ├── reader/           # ReaderView, BottomNav, TeachAnyButton, QuizModal
│   │       ├── chat/             # ChatPanel（苏格拉底对话）
│   │       ├── nav/              # TocDrawer（目录树 + 骨架 overlay + 聚合入口）
│   │       ├── book/             # KnowledgeGraphViewer（力导向图谱）
│   │       ├── profile/          # ProfileWizard（画像诊断向导）
│   │       └── layout/           # TopBar, SettingsDialog
│   ├── lib/
│   │   ├── api_client.ts         # 全部 API 函数（含 SSE streaming）
│   │   ├── api-config.ts         # 全局 API 配置中心
│   │   ├── types.ts              # TypeScript 类型定义
│   │   └── stores/               # Zustand 状态管理
│   │       ├── readerStore.ts    # 阅读器全局状态（阅读模式 / 进度）
│   │       ├── chatStore.ts      # 对话面板 + 自动标题提取
│   │       ├── graphStore.ts     # 知识图谱状态
│   │       └── noteStore.ts      # 笔记状态
│   ├── Dockerfile
│   └── package.json
│
├── backend/                      # 后端 (FastAPI)
│   ├── app/
│   │   ├── main.py               # 入口 + CORS
│   │   ├── master_router.py      # LLM 路由（骨架、对话、Quiz、Profile、会话）
│   │   ├── resource_router.py    # 资源路由（书籍 CRUD、章节、图谱、索引、上传）
│   │   ├── plugins_router.py     # 插件路由（TeachAny 知识沙盘）
│   │   ├── core/
│   │   │   └── config.py         # DATA_ROOT 路径解析
│   │   └── services/
│   │       ├── skeleton_service.py      # 动态目录生成 (Architect Agent)
│   │       ├── profile_service.py       # 学习画像管理 + Converge 诊断
│   │       ├── indexer_service.py       # 章节索引 (embedding + summary)
│   │       ├── quiz_service.py          # MCQ 章节测试
│   │       ├── chat_service.py          # 解释 / 联想 / 苏格拉底对话
│   │       ├── chat_session_service.py  # 对话历史 CRUD + title 更新
│   │       ├── note_service.py          # 笔记 CRUD
│   │       ├── teachany_service.py      # 知识沙盘课件生成
│   │       ├── document_processor.py    # PDF/EPUB/DOCX/TXT → MD
│   │       ├── book_pipeline.py         # 全书处理流水线
│   │       ├── rg_searcher.py           # ripgrep 文本搜索
│   │       └── prompts.py              # LLM Prompt 模板
│   ├── Dockerfile
│   ├── .env.example              # ⚠️ 复制为 .env 并填入 API Key
│   └── requirements.txt
│
├── data/                         # 数据存储（文件系统即数据库）
│   ├── raw/sources/{book}/       # 原始章节 Markdown
│   └── wiki/{book}/
│       ├── .meta.json            # 索引进度
│       ├── chapters_index.json   # 章节索引（summary + tags）
│       ├── dynamic_toc.json      # 个性化骨架
│       ├── .profile.json         # 学习画像
│       ├── graph.json            # 知识图谱
│       ├── notes/                # 用户笔记
│       └── chats/                # 对话历史
│
├── docker-compose.yml
├── .env.example
└── .gitignore
```

## API 概览

### Master Router (`/api`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/action` | POST | SSE — 解释 / 联想 |
| `/api/chat/socratic` | POST | SSE — 苏格拉底对话 |
| `/api/chat/answer` | POST | Quiz 答题（ABCD / E → converge） |
| `/api/chat/sessions/{book}` | GET / POST | 对话会话列表 / 新建 |
| `/api/chat/sessions/{book}/{sid}` | GET / DELETE | 会话详情 / 删除 |
| `/api/chat/sessions/{book}/{sid}/append` | POST | 追加消息到会话 |
| `/api/chat/sessions/{book}/{sid}/title` | PUT | 更新会话标题 |
| `/api/skeleton/generate` | POST | 生成动态目录 |
| `/api/skeleton/{book}` | GET | 读取骨架 |
| `/api/profile/extract` | POST | SSE — 画像提取 |
| `/api/profile/{book}` | GET / PUT / DELETE | 画像 CRUD |
| `/api/profile/flush_chapter` | POST | 刷入单章阅读记录 |
| `/api/profile/converge/save_baseline` | POST | 保存基线 |
| `/api/profile/converge/next` | POST | 单题苏格拉底轮次 |
| `/api/profile/converge/save` | POST | 保存完整画像 |
| `/api/quiz/generate_chapter_test` | POST | 生成章节测验 |
| `/api/dictionary` | POST | 术语查词 |
| `/api/notes` | GET / POST / DELETE | 笔记 CRUD |
| `/api/converge/start` | POST | 启动 converge 对话 |

### Resource Router (`/api`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/books` | GET | 列出所有书籍 |
| `/api/books/{book}` | GET / PUT / DELETE | 书籍信息 / 重命名 / 删除 |
| `/api/books/{book}/chapters` | GET | 章节列表 |
| `/api/books/{book}/chapters/*` | GET | 章节正文内容 |
| `/api/books/{book}/indexing-status` | GET | 索引构建状态 |
| `/api/books/{book}/build_index` | POST | 触发后台索引构建 |
| `/api/graph/{book}` | GET | 知识图谱数据 |
| `/api/pipeline/start` | POST | 全书处理流水线 |
| `/api/pipeline/status` | GET | 流水线状态 |
| `/api/upload` | POST | 上传书籍文件 |
| `/api/dictionary` | POST | 术语查词 |

### Plugins Router (`/api/plugins`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/plugins/teachany/generate` | POST | 生成知识沙盘 HTML |
| `/api/plugins/teachany/view/{book}/{file}` | GET | 读取生成的知识沙盘 |

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | **必填** |
| `DEEPSEEK_BASE_URL` | API 地址 | `https://api.deepseek.com/v1` |
| `NEXT_PUBLIC_API_URL` | 前端请求的后端地址 | `http://localhost:8000` |

### 前端 API 配置

`app/lib/api-config.ts` 统一管理后端地址：

- `API_BASE_URL` — 受 `NEXT_PUBLIC_API_URL` 控制，API 调用
- `BACKEND_STATIC_URL` — 与 `API_BASE_URL` 一致，知识沙盘静态文件直连
- `resolveTeachAnyUrl()` — 将相对路径拼接为完整课件 URL

Docker 环境中设置 `NEXT_PUBLIC_API_URL=http://backend:8000` 即可。

## 支持格式

| 格式 | 解析引擎 |
|------|----------|
| PDF | PyMuPDF (pymupdf4llm) |
| EPUB | ebooklib + BeautifulSoup |
| DOCX | python-docx |
| TXT / Markdown / HTML / LaTeX | 内建解析器 |

## 架构原则

1. **文件系统即数据库** — 无外部数据库依赖，数据可版本控制
2. **插件物理隔离** — 插件路由独立于核心路由，互不耦合
3. **沙盒课件** — 知识沙盘生成独立 HTML，不注入 iframe，不接入 Zustand
4. **反幻觉守门员** — 内容不足时禁用 AI 功能，防止低质量输出
5. **绝对导入** — Python 统一 `from app.xxx`，前端统一 `@/` 别名

## License

MIT
