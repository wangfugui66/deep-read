# DeepRead-v2

AI 深度阅读助手 — 让每一本书都有一位 AI 导师。

## 概述

DeepRead-v2 是一个基于 LLM 的智能阅读系统。上传一本书，AI 自动为你建立个性化的四级阅读策略矩阵（精读 / 速读 / 选读 / 跳过），在阅读过程中提供苏格拉底式对话、章节测验、知识图谱可视化、交互式课件生成等功能。

**核心理念：文件系统即数据库。** 无需 PostgreSQL、Redis 等外部依赖，所有状态（书籍、索引、画像、笔记、对话记录）以 Markdown / JSON 文件存放在 `data/` 目录下。

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

- Python 3.10+
- Node.js 18+
- DeepSeek API Key（[获取地址](https://platform.deepseek.com/)）

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt

# 配置 API Key
echo "DEEPSEEK_API_KEY=sk-your-key-here" > .env

# 启动
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
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
DEEPSEEK_API_KEY=sk-your-key-here docker compose up
```

## 使用流程

```
上传书籍 → 文档自动解析 → 后台索引构建
    ↓
首次使用 → 学习画像诊断（Baseline → Socratic → Preference）
    ↓
画像完成 → AI 生成四级阅读策略矩阵（Architect Agent）
    ↓
目录叠加显示：精读🔴 / 速读🟡 / 选读🔵 / 跳过⚪
    ↓
精读章节 → 关卡测验（≥80% 通过）
    ↓
随时对话 → 苏格拉底式 AI 导师
    ↓
全局视角 → 知识图谱可视化（力导向图 + 节点导航）
```

## 项目结构

```
DeepRead-v2/
├── app/                          # 前端 (Next.js 15)
│   ├── app/
│   │   ├── page.tsx              # 首页 → /books
│   │   ├── books/page.tsx        # 书架（上传、管理书籍）
│   │   ├── read/[bookName]/page.tsx  # 阅读器主页
│   │   └── components/
│   │       ├── reader/           # ReaderView, QuizModal, SelectionToolbar 等
│   │       ├── chat/             # ChatPanel（苏格拉底对话）
│   │       ├── nav/              # TocDrawer（骨架目录）
│   │       ├── book/             # GraphModal（知识图谱）
│   │       ├── profile/          # ProfileWizard（画像诊断）
│   │       └── layout/           # TopBar, SettingsDialog
│   └── lib/
│       ├── api_client.ts         # 全部 API 函数（含 SSE streaming）
│       ├── api-config.ts         # 全局 API 配置中心
│       ├── types.ts              # TypeScript 类型定义
│       └── stores/               # Zustand 状态管理
│           ├── readerStore.ts
│           ├── chatStore.ts      # 含 extractChatTitle 自动标题提取
│           ├── graphStore.ts
│           └── noteStore.ts
│
├── backend/                      # 后端 (FastAPI)
│   ├── app/
│   │   ├── main.py               # 入口
│   │   ├── master_router.py      # LLM 路由（骨架、对话、Quiz、Profile）
│   │   ├── resource_router.py    # 资源路由（书籍 CRUD、图谱、索引）
│   │   ├── plugins_router.py     # 插件路由（TeachAny 等）
│   │   └── services/
│   │       ├── skeleton_service.py      # 动态目录生成
│   │       ├── profile_service.py       # 学习画像管理
│   │       ├── indexer_service.py       # 章节索引 + 图谱构建
│   │       ├── quiz_service.py          # MCQ 生成
│   │       ├── chat_service.py          # 解释 / 联想 / 苏格拉底对话
│   │       ├── chat_session_service.py  # 对话历史管理
│   │       ├── note_service.py          # 笔记 CRUD
│   │       ├── teachany_service.py      # TeachAny 课件生成
│   │       ├── document_processor.py    # PDF/EPUB/DOCX/TXT → MD
│   │       ├── book_pipeline.py         # 全书处理流水线
│   │       ├── rg_searcher.py           # ripgrep 文本搜索
│   │       └── prompts.py              # LLM Prompt 模板
│   ├── .env                    # API Key（不提交 Git）
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
└── docker-compose.yml
```

## 核心功能

### 个性化骨架 (Skeleton / Dynamic TOC)

Architect Agent 根据你的学习画像，将全书章节归类为四级策略：

| 策略 | 含义 | 行为 |
|------|------|------|
| 精读 | 核心内容 | 需要 Quiz 通关 |
| 速读 | 背景知识 | 快速浏览 |
| 选读 | 扩展材料 | 按兴趣选择 |
| 跳过 | 无关内容 | 自动折叠 |

### 苏格拉底对话

基于费曼学习法和苏格拉底反诘法的 AI 导师。划线点击「解释」或「联想」，或在聊天框自由提问。支持 SSE 流式响应，逐 token 实时渲染。对话历史自动保存，首次消息自动提取为对话标题。

### 章节测验

精读章节读完后，AI 生成 4 道单选题 + 1 道思考题。需 ≥80% 正确率过关，不合格可重试。守门员机制确保你不会跳过关键内容。

### 知识图谱

前端 Canvas 力导向图，自动布局。节点类型：概念 / 术语 / 人物 / 事件。悬停高亮邻居，点击聚焦 2.5x 变焦 + 知识卡片（含关联章节摘要），可跳转至原文。

### TeachAny 课件生成

将单节或整章内容提炼为交互式 HTML 微课件。内置反幻觉守门员（字数不足 / 策略为「跳过」时禁用）。支持章层级聚合（将多节内容合并为一个大课件）。生成结果在新标签页以沙盒 HTML 形式打开。

### 学习画像诊断

三阶段问卷（Baseline → Socratic → Preference），诊断你的学习偏好、知识背景和目标，作为骨架生成的前置输入。

## API 概览

### Master Router (`/api`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat/action` | POST | SSE — 解释 / 联想 |
| `/api/chat/socratic` | POST | SSE — 苏格拉底对话 |
| `/api/skeleton/generate` | POST | 生成动态目录 |
| `/api/skeleton/{book}` | GET | 读取骨架 |
| `/api/profile/extract` | POST | SSE — 画像提取 |
| `/api/profile/{book}` | GET | 读取画像 |
| `/api/quiz/generate_chapter_test` | POST | 生成章节测验 |
| `/api/dictionary` | POST | 术语查词 |
| `/api/notes` | GET/POST/DELETE | 笔记 CRUD |
| `/api/chat/sessions/{book}` | GET/POST | 对话会话管理 |
| `/api/chat/sessions/{book}/{sid}` | GET/DELETE | 会话读写删 |
| `/api/chat/sessions/{book}/{sid}/append` | POST | 追加消息 |

### Resource Router (`/api`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/books` | GET | 列出书籍 |
| `/api/books/{book}` | GET/PUT/DELETE | 书籍 CRUD |
| `/api/upload` | POST | 上传书籍 |
| `/api/pipeline/start` | POST | 流水线 |
| `/api/graph/{book}` | GET | 知识图谱 |
| `/api/books/{book}/chapters` | GET | 章节列表 |
| `/api/books/{book}/chapters/*` | GET | 章节正文 |

### Plugins Router (`/api/plugins`)

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/plugins/teachany/generate` | POST | 生成课件 HTML |
| `/api/plugins/teachany/view/{book}/{file}` | GET | 查看课件 |

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | 必填 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.deepseek.com/v1` |
| `NEXT_PUBLIC_API_URL` | 前端请求的后端地址 | `http://localhost:8000` |

### 前端 API 配置

前端通过 `app/lib/api-config.ts` 统一管理后端地址：

```typescript
API_BASE_URL          // 受 NEXT_PUBLIC_API_URL 控制，API 调用
BACKEND_STATIC_URL    // 硬编码 localhost:8000，静态资源直连
resolveBackendUrl()   // API 代理路径解析
resolveTeachAnyUrl()  // 课件静态文件直连
```

## 支持格式

- PDF（via PyMuPDF）
- EPUB（via ebooklib）
- DOCX（via python-docx）
- TXT / Markdown / HTML / LaTeX

## 架构原则

1. **文件系统即数据库** — 无外部数据库依赖，数据可版本控制
2. **插件物理隔离** — 插件路由独立于核心路由，互不耦合
3. **沙盒课件** — TeachAny 生成独立 HTML，不注入 iframe，不接入 Zustand
4. **反幻觉守门员** — 内容不足时禁用 AI 功能，防止低质量输出
5. **绝对导入** — Python 统一 `from app.xxx`，消除相对导入歧义

## License

MIT
