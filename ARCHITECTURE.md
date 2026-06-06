# DeepRead-v2 — 架构设计文档

> 版本：1.0
> 最后更新：2025-07-11
> 目标读者：架构师、后端/前端开发人员
> 项目路径：`D:\DeepRead-v2`

---

## 目录

1. [系统概述](#1-系统概述)
2. [架构原则 & 设计决策](#2-架构原则--设计决策)
3. [数据层：文件系统即数据库](#3-数据层文件系统即数据库)
4. [后端架构](#4-后端架构)
5. [前端架构](#5-前端架构)
6. [SSE 流式协议规范](#6-sse-流式协议规范)
7. [多 Agent 协作系统](#7-多-agent-协作系统)
8. [安全模型](#8-安全模型)
9. [已知技术债务 & 风险](#9-已知技术债务--风险)
10. [部署 & 运维](#10-部署--运维)

---

## 1. 系统概述

### 1.1 定位

DeepRead-v2 是一个 **AI 深度阅读助手**。用户上传书籍（PDF/EPUB/DOCX/TXT/MD），系统将其拆分为章节，通过 LLM 分析内容，生成个性化阅读路径（骨架），提供苏格拉底式 AI 对话、章节 Quiz 守门、知识图谱可视化。

### 1.2 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Next.js (App Router) | 15.5 |
| UI 层 | React | 18 |
| 状态管理 | Zustand | 4.x |
| 图标 | lucide-react | latest |
| 后端框架 | FastAPI | latest |
| 异步服务器 | uvicorn | latest |
| LLM | DeepSeek API (`deepseek-chat`) | — |
| 文件搜索 | ripgrep | 13.x |
| 容器化 | Docker Compose | — |

### 1.3 进程模型

```
┌──────────────────────┐     ┌──────────────────────┐
│   Next.js :3000      │────▶│   uvicorn :8000      │
│   (SSR + CSR)        │◀────│   (FastAPI + reload) │
└──────────────────────┘     └──────────┬───────────┘
                                        │ HTTP
                                        ▼
                                 ┌──────────────────┐
                                 │  DeepSeek API     │
                                 │  (deepseek-chat)  │
                                 └──────────────────┘
```

前端所有 `/api/*` 请求通过 `fetch()` 直接发送到后端 `127.0.0.1:8000`，不经过 Next.js API 路由代理。

---

## 2. 架构原则 & 设计决策

### 2.1 文件系统即数据库（File-system-as-DB）

**决策**：不使用 PostgreSQL、SQLite、Redis。所有持久化状态以文件形式存储在 `data/` 目录下。

**理由**：
- 个人阅读工具，数据量小（单用户、个位数书籍）
- 零运维成本，无需数据库安装/备份
- Markdown/JSON 文件可直接版本控制（Git）
- 便于开发者手工检查、调试、修复数据

**代价**：
- 无并发控制（单用户场景可接受）
- 无事务保证（文件写入不保证原子性）
- 搜索依赖 ripgrep 全文扫描（小规模可接受）

### 2.2 DATA_ROOT 路径解析

每个 Python 模块通过 `Path(__file__).resolve().parent...parent / "data"` 自定位项目根目录。由于模块深度不同，**parent 层数必须严格对应**：

| 文件位置 | parent 层数 | 最终路径 |
|---------|------------|---------|
| `backend/app/resource_router.py` | 3 | `D:\DeepRead-v2\data` |
| `backend/app/services/*.py` | 4 | `D:\DeepRead-v2\data` |

**禁止**使用相对路径（如 `../../data`）或环境变量，以避免不同工作目录启动时的路径漂移。

### 2.3 前端与后端直连

前端通过 `fetch(BASE_URL + path)` 直接请求后端，BASE_URL 默认为 `http://127.0.0.1:8000`。不使用 Next.js API Route 反向代理。

**理由**：避免双重序列化开销，简化 SSE 流式传输。代价是必须在后端配置 CORS。

### 2.4 SSE over WebSocket

LLM 流式响应使用 **Server-Sent Events** 而非 WebSocket。

**理由**：
- LLM 文本生成是单向流（server→client），SSE 足够
- 无需 WebSocket 握手、心跳、重连逻辑
- 浏览器原生 `EventSource` / `fetch().body.getReader()` 支持

### 2.5 多 Agent 架构

系统有 6 个独立 Agent（Profiler, Deconstructor, Architect, Reviewer, Feynman Quiz, Feynman Guide），每个由独立的 system prompt 定义。Agent 之间通过 JSON 文件传递状态，不共享内存。

---

## 3. 数据层：文件系统即数据库

### 3.1 目录拓扑

```
data/
├── raw/
│   └── sources/
│       └── {book_name}/          # 原始书稿（拆分后的 MD 文件）
│           ├── 0000_版权页.md
│           ├── 0001_目录.md
│           ├── ...
│           └── 0124_后记.md
│
└── wiki/
    └── {book_name}/
        ├── .meta.json            # 索引进度
        ├── chapters_index.json   # 章节索引
        ├── dynamic_toc.json      # 骨架/动态目录
        ├── .profile.json         # 学习画像 v2
        ├── graph.json            # 知识图谱
        ├── notes/                # 用户笔记
        └── chats/                # 对话历史
```

### 3.2 核心数据契约

#### `.meta.json` — 索引进度

```json
{
  "indexing_status": "pending | processing | completed",
  "indexed_chapters": 42,
  "total_chapters": 124,
  "cover_url": "data:image/png;base64,..."
}
```

#### `chapters_index.json` — 章节索引

```json
[
  {
    "title": "0001_目录",
    "path": "0001_目录.md",
    "order": 1,
    "parent_title": null,
    "summary": "本书系统阐述系统思想溯源...",
    "tags": ["系统论", "系统思想", "辩证系统观"],
    "is_indexed": true
  }
]
```

#### `.profile.json` — 学习画像 v2

```json
{
  "schema_version": 2,
  "core_memory": {
    "profession": "哲学系研究生",
    "learning_style": "theory_first",
    "cognitive_gaps": ["贝塔朗菲方程", "耗散结构"],
    "pain_point": "系统论基本概念模糊",
    "difficulty_hint": "中级",
    "daily_minutes": 30,
    "planned_days": 14
  },
  "episodic_memory": {
    "chapter_0010": {
      "status": "已掌握",
      "key_struggles": ["易经与系统的关系"],
      "aha_moments": ["阴阳五行是古代系统论的雏形"],
      "keywords": ["阴阳", "五行", "周易"]
    }
  }
}
```

`core_memory` 跨章节持久化，`episodic_memory` 按章节隔离。

#### `dynamic_toc.json` — 四级策略阅读矩阵

```json
{
  "modules": [
    {
      "title": "第一篇：系统思想溯源",
      "strategy": "精读",
      "chapters": [
        {
          "file_path": "0009_1_中国传统系统思想.md",
          "original_title": "1 中国传统系统思想",
          "recommended_time": 45,
          "difficulty_level": "中级",
          "why_this_matters": "中西方系统观比较是全书论证起点"
        }
      ]
    }
  ],
  "archived_chapters": [
    {
      "file_path": "0000_版权页.md",
      "original_title": "版权页",
      "strategy": "跳过",
      "reason": "元数据，无学习价值"
    }
  ]
}
```

四大策略：`精读`（Quiz 守门）、`速读`（直接放行）、`选读`（灰色标记）、`跳过`（虚线标记）。

#### `graph.json` — 知识图谱

```json
{
  "nodes": [
    {
      "id": "系统论",
      "type": "concept",
      "label": "系统论",
      "weight": 25,
      "summary": "系统论是系统科学的哲学..."
    }
  ],
  "edges": [
    {
      "source": "系统论",
      "target": "贝塔朗菲",
      "weight": 8,
      "relation": "创立"
    }
  ]
}
```

节点类型：`concept`、`term`、`person`、`event`。

---

## 4. 后端架构

### 4.1 路由分层

```
FastAPI app (main.py)
├── 全局路由：/ , /health
├── master_router (prefix="/api") — LLM 功能 (22 条路由)
│   ├── /chat/action          — SSE: 解释/联想
│   ├── /chat/socratic        — SSE: 苏格拉底对话
│   ├── /chat/answer          — Quiz 答案评估
│   ├── /converge/start       — 比喻发现
│   ├── /notes (CRUD)         — 用户笔记
│   ├── /profile/*            — 学习画像 CRUD + Converge 诊断
│   ├── /skeleton/*           — 骨架生成/读取
│   ├── /dictionary           — 术语查词
│   ├── /chat/sessions/*      — 对话历史管理
│   └── /quiz/*               — MCQ 生成
│
└── resource_router (prefix="/api") — 资源管理 (12 条路由)
    ├── /books (CRUD)         — 书籍增删改查
    ├── /books/{name}/chapters — 章节列表/内容
    ├── /books/{name}/indexing-status — 索引进度
    ├── /books/{name}/build_index — 强制索引
    ├── /pipeline/*           — 流水线管理
    ├── /graph/{name}         — 知识图谱
    ├── /dictionary           — 术语查词
    └── /upload               — 书籍上传
```

### 4.2 核心数据流：书籍上传 → 索引

```
POST /api/upload (base64)
  → document_processor.parse()
    → 拆分章节 → 写入 data/raw/sources/{book_name}/*.md
  → background_tasks.add_task(build_book_index, book_name)
    → 逐章调用 deepseek-chat 生成 summary + tags
    → 写入 data/wiki/{book_name}/chapters_index.json
    → 更新 .meta.json (indexing_status: "completed")
```

### 4.3 核心数据流：画像采集 → 骨架生成

```
ProfileWizard (前端)
  → convergeSaveBaseline()  → POST /api/profile/converge/save_baseline
  → convergeNext() × N       → POST /api/profile/converge/next (苏格拉底诊断)
  → convergeSaveFinal()      → POST /api/profile/converge/save
    → 写入 .profile.json
  → onProfileComplete()
    → generateSkeleton()     → POST /api/skeleton/generate
      → 读取 .profile.json + chapters_index.json
      → 调用 Architect Agent (deepseek-chat)
      → 写入 dynamic_toc.json
```

### 4.4 Service 层依赖关系

```
master_router.py
├── chat_service.py          ← chat_session_service, profile_service, prompts
├── profile_service.py       ← 文件 I/O + LLM
├── skeleton_service.py      ← 文件 I/O + LLM (Architect Agent)
├── quiz_service.py          ← 文件 I/O + LLM (Feynman Quiz Agent)
├── note_service.py          ← 纯文件 I/O
└── chat_session_service.py  ← 纯文件 I/O

resource_router.py
├── indexer_service.py       ← 文件 I/O + LLM (章节摘要)
├── document_processor.py    ← PDF/EPUB/DOCX/TXT 解析
├── book_pipeline.py         ← 编排多个 service
└── rg_searcher.py           ← ripgrep 调用 + LLM
```

**Service 之间无循环依赖**。所有 Service 通过函数参数传递 `data_root`。

### 4.5 后台任务

FastAPI `BackgroundTasks` 用于两种场景：

1. `build_book_index(book_name)` — 索引构建（5-15 分钟）
2. `book_pipeline.run_book_pipeline(book_name)` — 全书处理流水线

前端通过每 2 秒轮询 `indexing-status` 感知进度。

### 4.6 错误处理模式

```
资源不存在 → HTTPException(404)
参数校验失败 → Pydantic ValidationError → FastAPI 自动 422
LLM 调用失败 → SSE 流内 yield {"token": "❌ ..."}
文件 I/O 失败 → OSError → HTTPException(500)
```

---

## 5. 前端架构

### 5.1 路由设计

| 路由 | 页面 | 渲染模式 |
|------|------|---------|
| `/` | 首页 → 重定向 `/books` | SSR |
| `/books` | 书架 | CSR |
| `/read/[bookName]` | 阅读器 | CSR |

### 5.2 组件树

```
ReadPage (read/[bookName]/page.tsx)  ← 数据编排中心
├── TopBar                 ← 标题栏 + 设置
├── TocDrawer              ← 目录侧边栏 (骨架叠加 + 2s 轮询)
├── ReaderView             ← Markdown 正文渲染
├── ChatPanel              ← 苏格拉底对话 (SSE)
├── GraphModal             ← 知识图谱弹窗
│   └── KnowledgeGraphViewer ← Canvas 力导向图
├── QuizModal              ← MCQ 测试弹窗
├── ProfileWizardModal     ← 画像诊断
│   └── ProfileWizard      ← 多阶段表单
├── BottomNav              ← 章节导航
├── SelectionToolbar       ← 划词操作
└── InnerReaderHeader      ← 阅读设置
```

### 5.3 状态管理策略

| 状态类型 | 存储方式 | 说明 |
|---------|---------|------|
| 阅读器全局 | Zustand `readerStore` | 当前书籍、章节、主题、字体 |
| 聊天状态 | Zustand `chatStore` | 消息列表、会话 ID、加载状态 |
| 图谱 UI | Zustand `graphStore` | 弹窗开关、选中节点 |
| 书架页面 | 组件内 `useState` | 书籍列表、上传进度 |
| 用户偏好 | `localStorage` | 字号、主题、模式、API Key |

**Zustand stores 之间无订阅依赖**。跨 store 通信通过 `ReadPage` 协调层以回调方式传递。

### 5.4 关键交互时序

```
用户点击「下一章」
  → BottomNav.onNavigate()
  → 检查 readingMode + skeletonToc 策略
  → 如果是 intensive + "精读":
    → fetchQuizQuestions() → QuizModal 弹出
      → 通过 (≥80%): goToChapter() → fetchChapterContent()
      → 失败: 注入 weakness 报告到 chatStore
  → 否则直接 goToChapter()
```

### 5.5 Canvas 知识图谱实现

`KnowledgeGraphViewer.tsx` 使用 **原生 Canvas 2D** 实现力导向图：

- **物理引擎**：库仑斥力 (k=8000)、弹簧引力 (k=0.005)、阻尼 (0.88)、最大速度 (5)
- **渲染**：`requestAnimationFrame` 循环
- **交互**：mousemove 碰撞检测、click 聚焦变焦、wheel 缩放
- **知识卡片**：点击节点 → `fetchChapterContent` → overlay 显示章节摘要

---

## 6. SSE 流式协议规范

### 6.1 Wire Format

所有 SSE 端点使用 `media_type="text/event-stream"`：

```
data: <JSON>\n\n
```

### 6.2 Token 契约

| 事件类型 | JSON Shape | 发送时机 |
|---------|-----------|---------|
| 文本块 | `{"token": "..."}` | LLM 每次生成片段 |
| 流结束 | `{"done": true}` | 流正常/异常结束 |
| 画像就绪 | `{"event": "profile_readiness", "is_ready": true}` | profile/extract，token 之后 |
| 服务端错误 | `{"token": "❌ 服务端异常：..."}` | LLM 调用失败 |
| 客户端错误 | `{"token": "❌ 系统异常：..."}` | 网络/HTTP 错误 |

### 6.3 前端消费模式

```typescript
// AsyncGenerator 实现
async function* streamEndpoint(req: Request): AsyncGenerator<SSEChunk> {
  const res = await fetch(url, { method: "POST", body: JSON.stringify(req) });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data) yield JSON.parse(data);
        }
      }
    }
  } catch (err) {
    yield { token: `❌ 系统异常：${err.message}` };
  } finally {
    yield { done: true };
  }
}
```

### 6.4 ChatPanel 渲染模式

```
1. addMessage({ role: "assistant", content: "" })  ← 空占位消息
2. for await (chunk of stream) {
     if (chunk.done) break;
     appendToLast(chunk.token);  ← 逐步追加到 store 最后一条消息
   }
3. appendChatMessage(sessionId, "assistant", fullResponse)  ← 持久化
```

### 6.5 已知不一致

| 问题 | 端点 | 影响 |
|------|------|------|
| `[DONE]` sentinel 而非 `{"done": true}` | `profile/extract` | 前端 `JSON.parse("[DONE]")` 静默跳过 |
| 错误 shape 不一致 (`{"error": "..."}` vs `{"token": "..."}`) | `profile/extract` | 消费端未统一处理 |
| `streamProfileExtraction` 缺 `x-api-key` header | 前端 | API Key 模式失效 |
| 空 API Key 时返回裸字符串 | `chat_service` | 前端 JSON.parse 失败 → 无输出 |

---

## 7. 多 Agent 协作系统

### 7.1 Agent 清单

| Agent | System Prompt | 职责 | 输入 | 输出 |
|-------|-------------|------|------|------|
| **Profiler** | `PROFILER_SYSTEM_PROMPT` | 冰破式画像收集 | 用户自由文本 | 画像字段 |
| **Deconstructor** | `DECONSTRUCTOR_SYSTEM_PROMPT` | 客观提取知识单元 | 章节 MD | 概念/命题/案例 + 关系 |
| **Architect** | `ARCHITECT_SYSTEM_PROMPT` + `ARCHITECT_TOC_PROMPT` | 个性化阅读路径规划 | 画像 + 目录 | 四级策略矩阵 |
| **Reviewer** | `REVIEWER_SYSTEM_PROMPT` | TOC 质量审计 | Architect 输出 | 审核报告 |
| **Feynman Quiz** | `FEYNMAN_QUIZ_PROMPT` | 生成苏格拉底式 MCQ | 章节 + 画像 | 5 道个性化选择题 |
| **Feynman Guide** | `FEYNMAN_GUIDE_PROMPT` + `SOCRATIC_CHAT_SYSTEM_PROMPT` | 苏格拉底式教学 | 章节 + 画像 + 历史 | 流式教学文本 |

### 7.2 Agent 调用编排

```
用户上传书籍
  └─ Indexer (逐章) → chapters_index.json

用户完成 ProfileWizard
  └─ Architect → dynamic_toc.json
       └─ (可选) Reviewer → 审计修订

用户进入精读章节
  └─ Feynman Quiz → 5 MCQ
       ├─ 通过 → 阅读
       └─ 失败 → 弱点注入 ChatPanel

用户发起对话
  └─ Feynman Guide → 苏格拉底式教学 (SSE)

用户划词
  └─ Deconstructor 或 Feynman Guide → 解释/联想 (SSE)
```

### 7.3 Agent 间状态传递

Agent 之间通过 **JSON 文件** 传递状态，无内存共享：

- Profiler → `.profile.json` → Architect
- Architect → `dynamic_toc.json` → Reviewer
- Reviewer → `dynamic_toc.json` → 前端
- Quiz 弱点 → `chatStore` → ChatPanel → Feynman Guide 下次调用时作为上下文

---

## 8. 安全模型

### 8.1 认证

当前版本无用户认证。前端通过 `localStorage.getItem("dr-api-key")` 获取 API Key，注入 `x-api-key` header。后端 `verify_api_key` 中间件目前为 **空实现**。

### 8.2 路径遍历防护

`resource_router.py` 中 `get_chapter_content` 通过 `Path.resolve()` + parent 检查防止路径遍历攻击。

### 8.3 书名校验

`master_router.py` 中 `_validate_book_name()` 黑名单过滤 `"目录"`, `"README"` 等系统保留名。

### 8.4 CORS & 敏感信息

- 开发环境：`allow_origins=["*"]`
- `DEEPSEEK_API_KEY` 在 `backend/.env`，已加入 `.gitignore`
- 前端 API Key 存储在浏览器 `localStorage`（明文）

---

## 9. 已知技术债务 & 风险

### 高优先级

| ID | 问题 | 影响 | 建议 |
|----|------|------|------|
| TD-01 | SSE token shape 不一致 | `profile/extract` 使用 `[DONE]`/`{"error"}` 而非标准 shape | 统一为 `{type, data}` |
| TD-02 | `profile/extract` 缺少 `x-api-key` header | API Key 校验开启后失效 | 修复 `api_client.ts` |
| TD-03 | 空 API Key 时返回非 JSON 裸字符串 | 前端静默无报错 | 后端 yield 标准 error token |
| TD-04 | 无并发控制 | 多线程同时写同一 JSON 可能损坏 | 单用户影响小，长期加文件锁 |
| TD-05 | `backend/data/` 下有旧数据残留 | 占空间 | 确认功能后删除 |

### 中优先级

| ID | 问题 | 影响 | 建议 |
|----|------|------|------|
| TD-06 | Pydantic models 分散在两个 router | 无共享 Schema，双重维护 | 提取到 `app/core/schemas.py` |
| TD-07 | 自定义 Canvas 物理引擎 | 复杂交互不完整 | 评估迁移到 d3-force |
| TD-08 | 无测试覆盖 | 重构风险高 | 为核心 service 添加 pytest |
| TD-09 | 骨架生成无缓存 | 每次触发都调 LLM | 加版本号，画像未变则复用 |
| TD-10 | ripgrep 依赖外部二进制 | 部署需额外安装 | 小数据可回退 Python `re` |

### 低优先级

| ID | 问题 | 影响 | 建议 |
|----|------|------|------|
| TD-11 | `ProfileWizard.tsx` 过大 (~700 行) | 维护困难 | 拆分 Phase 子组件 |
| TD-12 | 消息列表无虚拟滚动 | 长对话性能下降 | 引入 `react-virtuoso` |
| TD-13 | Canvas 图谱无响应式 | 移动端不可用 | 添加 ResizeObserver |

---

## 10. 部署 & 运维

### 10.1 开发环境启动

```bash
# Terminal 1 — 后端
cd D:\DeepRead-v2\backend
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2 — 前端
cd D:\DeepRead-v2\app
npx next dev --port 3000
```

### 10.2 构建索引

```bash
# Swagger: http://localhost:8000/docs → POST /api/books/{name}/build_index
# curl:
curl -X POST http://127.0.0.1:8000/api/books/系统论_系统科学与哲学/build_index
```

### 10.3 目录清理

```bash
rm -rf D:\DeepRead-v2\backend\data  # 旧 DATA_ROOT 残留
rm -rf D:\DeepRead-v2\app\.next     # 前端构建缓存
```

### 10.4 环境变量

| 变量 | 位置 | 默认值 | 说明 |
|------|------|--------|------|
| `DEEPSEEK_API_KEY` | `backend/.env` | — | DeepSeek API 密钥 |
| `DEEPSEEK_BASE_URL` | `backend/.env` | `https://api.deepseek.com/v1` | API 端点 |
| `NEXT_PUBLIC_API_URL` | `.env.local` | `http://127.0.0.1:8000` | 后端地址 |

---

## 附录 A：文件清单

### 后端文件（17 个）

```
backend/app/
├── main.py                    # FastAPI 入口 + CORS + load_dotenv
├── master_router.py           # 22 条 LLM 路由
├── resource_router.py         # 12 条资源路由
├── core/                      # 空 — 待放置共享 Schema
└── services/
    ├── book_pipeline.py       # 全书处理编排
    ├── chat_service.py        # 解释/联想/苏格拉底对话
    ├── chat_session_service.py# 对话历史 CRUD
    ├── document_processor.py  # PDF/EPUB/DOCX → MD
    ├── indexer_service.py     # 章节索引 (summary + tags)
    ├── note_service.py        # 笔记 CRUD
    ├── profile_service.py     # 学习画像 + Converge 诊断
    ├── prompts.py             # 所有 Agent system prompt
    ├── quiz_service.py        # MCQ 生成
    ├── rg_searcher.py         # ripgrep 搜索
    └── skeleton_service.py    # 骨架生成
```

### 前端文件（20 个）

```
app/
├── app/
│   ├── page.tsx               # 首页重定向
│   ├── layout.tsx             # 根布局
│   ├── globals.css            # 全局样式
│   ├── books/page.tsx         # 书架页
│   ├── read/[bookName]/page.tsx # 阅读器页 (核心编排)
│   └── components/
│       ├── book/
│       │   ├── GraphModal.tsx
│       │   └── KnowledgeGraphViewer.tsx
│       ├── chat/ChatPanel.tsx
│       ├── layout/
│       │   ├── TopBar.tsx
│       │   ├── SettingsDialog.tsx
│       │   └── ProfileDialog.tsx
│       ├── nav/TocDrawer.tsx
│       ├── profile/
│       │   ├── ProfileWizard.tsx
│       │   └── ProfileWizardModal.tsx
│       └── reader/
│           ├── ReaderView.tsx
│           ├── QuizModal.tsx
│           ├── BottomNav.tsx
│           ├── SelectionToolbar.tsx
│           └── InnerReaderHeader.tsx
└── lib/
    ├── api_client.ts          # 31 个 API 函数
    ├── types.ts               # TS 类型定义
    └── stores/
        ├── readerStore.ts
        ├── chatStore.ts
        ├── graphStore.ts
        └── noteStore.ts
```

---

## 附录 B：完整 API 速查表

### master_router（22 条）

| 方法 | 路径 | 类型 | 功能 |
|------|------|------|------|
| POST | `/api/chat/action` | SSE | 解释/联想 |
| POST | `/api/chat/socratic` | SSE | 苏格拉底对话 |
| POST | `/api/chat/answer` | JSON | Quiz 答案处理 |
| POST | `/api/converge/start` | JSON | 比喻发现 |
| POST | `/api/notes` | JSON | 创建笔记 |
| GET | `/api/notes` | JSON | 列出笔记 |
| DELETE | `/api/notes` | JSON | 删除笔记 |
| POST | `/api/profile/extract` | SSE | 画像提取 |
| GET | `/api/profile/{name}` | JSON | 读取画像 |
| DELETE | `/api/profile/{name}` | JSON | 删除画像 |
| PUT | `/api/profile/{name}` | JSON | 写入画像 |
| POST | `/api/profile/flush_chapter` | JSON | 刷新章节记忆 |
| POST | `/api/profile/converge/save_baseline` | JSON | Converge 基线 |
| POST | `/api/profile/converge/next` | JSON | Converge 下一问 |
| POST | `/api/profile/converge/save` | JSON | Converge 完成 |
| POST | `/api/skeleton/generate` | JSON | 生成骨架 |
| GET | `/api/skeleton/{name}` | JSON | 读取骨架 |
| POST | `/api/dictionary` | JSON | 术语查词 |
| GET | `/api/chat/sessions/{name}` | JSON | 列出会话 |
| GET | `/api/chat/sessions/{name}/{id}` | JSON | 读取会话 |
| POST | `/api/chat/sessions/{name}` | JSON | 创建会话 |
| DELETE | `/api/chat/sessions/{name}/{id}` | JSON | 删除会话 |
| POST | `/api/chat/sessions/{name}/{id}/append` | JSON | 追加消息 |
| POST | `/api/quiz/generate_chapter_test` | JSON | 生成 MCQ |

### resource_router（12 条）

| 方法 | 路径 | 类型 | 功能 |
|------|------|------|------|
| GET | `/api/books` | JSON | 列出书籍 |
| GET | `/api/books/{name}` | JSON | 书籍元数据 |
| PUT | `/api/books/{name}` | JSON | 重命名/封面 |
| DELETE | `/api/books/{name}` | JSON | 删除书籍 |
| GET | `/api/books/{name}/indexing-status` | JSON | 索引进度 |
| POST | `/api/books/{name}/build_index` | JSON | 构建索引 |
| POST | `/api/pipeline/start` | JSON | 启动流水线 |
| GET | `/api/pipeline/status` | JSON | 流水线进度 |
| GET | `/api/books/{name}/chapters` | JSON | 章节列表 |
| GET | `/api/books/{name}/chapters/{path:path}` | JSON | 章节内容 |
| GET | `/api/graph/{name}` | JSON | 知识图谱 |
| POST | `/api/upload` | JSON | 上传书籍 |
