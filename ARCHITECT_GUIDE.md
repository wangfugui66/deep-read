# DeepRead-v2 — 架构师开发指南

> 目标读者：专业软件架构师（人或 AI）
> 定位：指导后续开发工作的架构级作战地图
> 配套文档：`HANDOVER.md`（接口清单）、`ARCHITECTURE.md`（系统设计）
> 最后更新：2026-06-08

---

## 快速导航

| 你想做什么 | 读哪个章节 |
|-----------|-----------|
| 理解系统为什么这样设计 | 第 1 章：架构决策记录 |
| 知道从哪里加新功能 | 第 2 章：扩展点地图 |
| 遵循现有代码模式 | 第 3 章：编码规范与模式 |
| 理解数据怎么流动 | 第 4 章：核心数据流 |
| 避免踩已知的坑 | 第 5 章：反模式与禁区 |
| 评估改动风险和范围 | 第 6 章：变更影响分析 |
| 看懂多 Agent 怎么协作 | 第 7 章：Agent 编排协议 |

---

## 1. 架构决策记录 (ADR)

### ADR-01：文件系统即数据库
- **决策**：不使用任何关系型/非关系型数据库。所有状态以 Markdown/JSON 文件存储在 `data/`。
- **理由**：单用户阅读工具，数据量 < 100MB，零运维成本，Git 可追踪。
- **约束**：任何新功能的数据持久化必须走文件 I/O，不得引入 `sqlite3`、`redis`、`pymongo` 等。
- **代价**：无并发控制、无事务、搜索靠 grep。当前规模可接受。

### ADR-02：前端直连后端，不经 Next.js 代理
- **决策**：前端 `fetch()` 直接请求 `localhost:8000`，不使用 Next.js API Route。
- **理由**：SSE 流式传输不需要中间层，避免双重序列化。
- **约束**：新增 API 必须在此模式下测试 CORS。`NEXT_PUBLIC_API_URL` 是唯一配置点。
- **代价**：生产部署需反向代理或 CORS 白名单。

### ADR-03：SSE 优先于 WebSocket
- **决策**：LLM 文本流使用 Server-Sent Events，不用 WebSocket。
- **理由**：单向流足够，无需握手/心跳/重连复杂度。
- **约束**：新增流式端点必须遵循 `data: <JSON>\n\n` 格式。
- **已知问题**：`profile/extract` 端点的 SSE shape 不一致（见 TD-01），需统一。

### ADR-04：多 Agent 通过 JSON 文件通信
- **决策**：6 个 Agent 之间不共享内存实例，通过 `data/wiki/{book}/*.json` 传递状态。
- **理由**：无状态 LLM 调用天然适合，文件即检查点，可单独调试。
- **约束**：新增 Agent 必须定义清晰的输入/输出文件契约，不隐式依赖其他 Agent 的内存状态。

### ADR-05：画像 v2 — 核心记忆 + 情景记忆双层架构
- **决策**：`core_memory`（用户不变特征）跨章节持久化，`episodic_memory`（章节交互）按章节隔离。
- **理由**：画像写入是性能瓶颈；分层减少 LLM 上下文膨胀。
- **约束**：新增画像字段先判断归属层，不对 `episodic_memory` 做跨章节查询。

### ADR-06：知识动画采用 HyperFrames + 外部播放器
- **决策**：动画不内嵌在前端组件中渲染，由 DeepSeek 生成独立 HTML，通过 `@hyperframes/player` Web Component 播放。
- **理由**：隔离 LLM 生成代码的安全风险，播放器提供统一控制面。
- **约束**：动画 HTML 必须满足 5 条物理法则（见 `prompts/knowledge_animation.md`）。
- **当前 Prompt 策略**：SVG 图解 + GSAP 特效模式（经历 Apple Text → SVG 回滚的迭代）。

### ADR-07：四级阅读策略矩阵
- **决策**：章节分为 精读 / 速读 / 选读 / 跳过 四级。
- **理由**：用户时间有限，Architect Agent 根据画像决定每章策略。
- **约束**：精读章触发 Quiz 守门（80% 通过门槛），其他等级直接放行。

---

## 2. 扩展点地图

### 2.1 添加新的 Agent

```
扩展点：backend/app/services/prompts.py
模板：在 DEEPSEEK_TEMPLATE 后追加新的 PROMPT 常量

扩展点：backend/app/services/
模板：复制 chat_service.py 的流式模板
  - 入口函数签名：async def my_agent_stream(...) → AsyncGenerator[str]
  - yield "data: " + json.dumps({"token": chunk}) + "\n\n"
  - 最后 yield "data: " + json.dumps({"done": true}) + "\n\n"

扩展点：backend/app/master_router.py
模板：在 plugins_router 上方新增路由
  - 类型标注：@master_router.post("/my-agent") 或 .get()
  - 响应类型：StreamingResponse 或 Pydantic Model

扩展点：app/lib/api_client.ts
模板：复制 streamSocraticChat 的 AsyncGenerator 模式

扩展点：app/app/components/
模板：新建组件，接入 Zustand store，调用 api_client 函数
```

### 2.2 添加新的前端页面

```
创建文件：app/app/my-feature/page.tsx
模式：标记 "use client"，不支持 SSR
路由：自动映射为 /my-feature

添加导航入口：修改 TopBar.tsx 或 BottomNav.tsx
```

### 2.3 添加新的 Zustand Store

```
创建文件：app/lib/stores/myStore.ts
模式：
  import { create } from "zustand";
  export const useMyStore = create<MyState>((set, get) => ({ ... }));
注意：store 之间不互相订阅，通过 ReadPage 协调层通信
```

### 2.4 添加新的数据文件类型

```
定义模式：在 data/wiki/{book}/ 下新增 .json 或 .md 文件
读写服务：新建或扩展现有 service 模块
前端类型：在 app/lib/types.ts 新增接口
API 端点：新增 resource_router 或 master_router 路由
索引构建：如需后台处理，复用 BackgroundTasks 模式
```

### 2.5 替换 LLM 提供商

```
修改文件：所有 service 中的 AsyncOpenAI 初始化
当前硬编码：base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
影响范围：13 个 service 文件中的 LLM 调用
建议：抽取 LLM 工厂函数到 utils/llm_client.py
```

---

## 3. 编码规范与模式

### 3.1 Python 后端

**文件 I/O 模式**：
```python
from app.core.config import DATA_ROOT

# 读
path = DATA_ROOT / "wiki" / book_name / "data.json"
if path.is_file():
    data = json.loads(path.read_text(encoding="utf-8"))

# 写（原子）
from app.utils.file_ops import atomic_write_json
atomic_write_json(path, data)
```

**LLM 调用模式**：
```python
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=api_key, base_url="...")
response = await client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "system", "content": prompt}, {"role": "user", "content": user_input}],
    temperature=0.6,
    max_tokens=4096,
)
content = response.choices[0].message.content
```

**路由定义模式**：
```python
@master_router.post("/my-endpoint")
async def my_endpoint(req: MyRequest, x_api_key: str = Header(None)):
    # 1. 验证输入
    # 2. 读取数据文件
    # 3. 调用 LLM
    # 4. 写入结果
    # 5. 返回 JSON
    return {"status": "ok", "data": result}
```

**错误处理模式**：
```python
# 资源不存在 → 404
if not path.is_file():
    raise HTTPException(404, f"Resource not found: {path}")

# LLM 异常 → 500 或 SSE error token
try:
    response = await client.chat.completions.create(...)
except Exception as e:
    logger.exception("LLM call failed")
    raise HTTPException(500, f"LLM error: {e}")
```

### 3.2 TypeScript 前端

**API 调用模式**：
```typescript
// 普通 JSON
const res = await fetch(`${BASE}/api/books`, { headers: { "x-api-key": apiKey } });
const data = await res.json();

// SSE 流式
const stream = streamSocraticChat(bookName, msg, chapterPath, history);
for await (const chunk of stream) {
    if (chunk.done) break;
    appendToLast(chunk.token);
}
```

**Zustand Store 模式**：
```typescript
interface MyState {
    data: MyData | null;
    loading: boolean;
    load: () => Promise<void>;
}

export const useMyStore = create<MyState>((set) => ({
    data: null,
    loading: false,
    load: async () => {
        set({ loading: true });
        const data = await fetchMyData();
        set({ data, loading: false });
    },
}));
```

---

## 4. 核心数据流

### 4.1 书籍生命周期

```
上传 (base64)
  │
  ▼
document_processor.parse()
  ├── PDF → PyMuPDF TOC 拆分 → N 个 .md 文件
  ├── EPUB → ebooklib → N 个 .md 文件
  ├── DOCX → python-docx → .md
  └── TXT/MD → 直接拷贝
  │
  ▼
写入 data/raw/sources/{book_name}/*.md
  │
  ▼
BackgroundTasks: build_book_index(book_name)
  ├── 读取每个 .md
  ├── 调用 DeepSeek: 生成 summary + tags
  ├── 写入 chapters_index.json
  └── 更新 .meta.json (indexing_status: "completed")
```

### 4.2 画像 → 骨架 → 阅读

```
ProfileWizard (前端多阶段表单)
  │
  ├─ 阶段1: 基线数据 → POST /api/profile/converge/save_baseline
  └─ 阶段2: 苏格拉底诊断 (最多10轮) → POST /api/profile/converge/next
  │
  ▼
.converge/save → 写入 .profile.json
  │
  ▼
POST /api/skeleton/generate
  ├── 读取 .profile.json + chapters_index.json
  ├── Architect Agent: 四级策略矩阵
  └── 写入 dynamic_toc.json
  │
  ▼
TocDrawer 渲染带策略标注的目录树
  │
  ▼
用户点击章节 → 检查策略
  ├── 精读 → QuizModal (5题, 通过率≥80%)
  │   ├── 通过 → fetchChapterContent → ReaderView
  │   └── 失败 → 弱点注入 ChatPanel
  └── 速读/选读/跳过 → 直接 fetchChapterContent
```

### 4.3 苏格拉底对话循环

```
ChatPanel (用户键入消息)
  │
  ▼
streamSocraticChat(bookName, msg, chapterPath, history)
  │
  ▼
POST /api/chat/socratic (SSE)
  ├── 读取 .profile.json + 当前章节 .md
  ├── Feynman Guide Agent 生成教学文本
  └── SSE 流式返回 token 序列
  │
  ▼
ChatPanel 逐步渲染 token
  │
  ▼
用户响应后追加到 chatStore → appendChatMessage 持久化
```

### 4.4 知识动画生成

```
用户选中章节 → 点击动画按钮
  │
  ▼
POST /api/plugins/animation/generate
  ├── 读取原始章节 .md 文件
  ├── 拼接 system prompt (prompts/knowledge_animation.md)
  ├── 调用 DeepSeek 生成完整 HTML
  ├── _extract_clean_html() 提取纯净 HTML
  └── 返回 {"status": "ok", "html": "..."}
  │
  ▼
前端: html → BlobURL → hyperframes-player (Web Component)
```

---

## 5. 反模式与禁区

### 5.1 绝对禁止

| 禁区 | 原因 | 替代方案 |
|------|------|---------|
| 引入数据库依赖 | ADR-01 | 使用文件 I/O |
| 在动画 prompt 中允许 `tl.play()` | 破坏播放器接管 | 已在 prompt 中写入禁令 |
| 使用 Next.js API Route 代理后端 | ADR-02 | 前端直连 |
| 跨 store 直接订阅 | 循环依赖风险 | 通过 ReadPage 协调 |
| 隐式依赖 `.env` 的 API Key | BYOK 原则 | 从 request header 获取 |
| 相对路径定位 `data/` | 路径漂移 | 使用 `DATA_ROOT` |

### 5.2 强烈不建议

| 行为 | 问题 | 建议 |
|------|------|------|
| SSR 渲染阅读器页面 | 依赖浏览器 API (localStorage, Canvas) | 保持 `"use client"` |
| 在 service 中缓存 LLM 响应 | 缓存失效复杂 | 由文件系统自然缓存 |
| 修改 `prompts.py` 后不更新调用方 | 接口断裂 | 检查所有引用 |
| 新增 SSE 端点不统一 token shape | TD-01 恶化 | 严格遵循 `{token, done}` 契约 |

---

## 6. 变更影响分析

### 热力图

```
                    后端修改影响面
              低                        高
  prompts.py  ■□□□□
  main.py     ■■□□□
  config.py   ■■□□□
  *_router.py ■■■■□  ← 每次新增 API 都改
  *_service.py ■■■■□
  document_   ■■■■■  ← 改动影响所有上传
  processor

                    前端修改影响面
              低                        高
  types.ts    ■□□□□
  stores/     ■■□□□  ← 新增字段/action
  api_client  ■■■□□  ← 新增 API 函数
  ReadPage    ■■■■□  ← 核心编排层
  ReaderView  ■■■□□
  ChatPanel   ■■■□□
  QuizModal   ■■□□□
```

### 改动检查清单

每次修改后必须验证：
- [ ] `python -c "import ast; ast.parse(open('backend/app/services/modified.py').read())"` — Python 语法
- [ ] `cd app && npx tsc --noEmit` — TypeScript 编译
- [ ] 前端 `npm run dev` 可正常启动
- [ ] 后端 `uvicorn app.main:app` 可正常启动
- [ ] 新增/修改的路由在 Swagger UI (`/docs`) 中可见
- [ ] Pydantic model 字段与 TS 类型字段一致

---

## 7. Agent 编排协议

### 7.1 Agent 间调用契约

```
                    ┌──────────┐
                    │ Profiler │  ← 用户自由文本 → core_memory
                    └────┬─────┘
                         │ .profile.json
                         ▼
┌──────────────┐  ┌──────────────┐
│ Deconstructor│  │  Architect   │  ← core_memory + 目录 → dynamic_toc.json
│ (章节→概念)  │  └──────┬───────┘
└──────┬───────┘         │
       │ chapters_index   │ dynamic_toc.json
       ▼                  ▼
┌──────────────┐  ┌──────────────┐
│ Feynman Quiz │  │   Reviewer   │  ← 审计 dynamic_toc.json
│ (章节→MCQ)   │  └──────────────┘
└──────┬───────┘
       │ weakness report
       ▼
┌──────────────┐
│Feynman Guide │  ← profile + chapter + history → SSE 教学文本
└──────────────┘
```

### 7.2 新增 Agent 的接口规范

```
输入契约（声明在 service 函数签名）：
  - 文件路径: Path (指向 data/ 下的输入文件)
  - API Key: str (从 request header 传入，不读 .env)

输出契约（写入到 data/ 或返回 JSON）：
  - 文件路径: Path (指向 data/ 下的输出文件)
  - JSON body: Pydantic BaseModel

LLM 调用契约：
  - model: "deepseek-chat"
  - temperature: 0.6 (创作类可上调至 0.8)
  - max_tokens: 根据任务量设定 (4096–8192)

SSE 输出契约（如是流式端点）：
  - 每个 chunk: {"token": "文本片段"}
  - 流结束: {"done": true}
  - 异常: {"token": "❌ 错误描述"}
```

---

## 8. 关键性能参数

| 场景 | 典型耗时 | 瓶颈 |
|------|---------|------|
| 书籍上传 (10MB PDF) | 3-8 秒 | document_processor 解析 |
| 索引构建 (124 章) | 8-15 分钟 | DeepSeek API 串行调用 |
| 骨架生成 | 15-45 秒 | Architect Agent 推理 |
| Quiz 生成 | 8-15 秒 | Feynman Quiz Agent |
| 苏格拉底对话 | 流式, 首 token 1-3 秒 | DeepSeek API |
| 知识动画生成 | 30-90 秒 | DeepSeek 生成完整 HTML |
| 知识图谱构建 | 30-60 秒 | LLM 提取 + NetworkX 计算 |

---

## 9. 技术栈版本锁定

| 组件 | 版本 | 升级注意事项 |
|------|------|------------|
| Next.js | 15.5.x | App Router 破坏性变更在 14→15 |
| React | 18.x | 未升 19，React 19 有 hooks 变更 |
| Zustand | 4.x | v5 有 API 变更 |
| FastAPI | latest | Pydantic v2 语法已适配 |
| openai (Python) | >=1.50 | v1.x 重写了 `AsyncOpenAI` |
| PyMuPDF | latest | `pymupdf4llm` 依赖 |
| GSAP | 3.12.2 | CDN 硬编码在 prompt 中 |
| DeepSeek API | deepseek-chat | v3 模型 |

---

## 10. 快速上手：最小改动指南

### 想加一个"章节收藏"功能

1. **数据层**：在 `data/wiki/{book}/favorites.json` 存储 `{"favorites": ["0001_目录.md"]}`
2. **后端**：新建 `favorite_service.py`，在 `master_router.py` 加 `POST/GET/DELETE /api/favorites`
3. **前端类型**：`app/lib/types.ts` 新增 `FavoriteRef`
4. **API 客户端**：`app/lib/api_client.ts` 新增 `addFavorite() / removeFavorite()`
5. **UI**：在 `TocDrawer.tsx` 章节项后加收藏星标按钮

### 想替换 LLM 为 OpenAI

1. 改 `base_url`：`https://api.openai.com/v1`
2. 改 `model`：`gpt-4o`
3. 测试所有 Agent prompt 是否兼容（DeepSeek 的 system prompt 处理略有不同）
4. 关注 token 消耗（GPT-4 成本高 10-30 倍）

### 想加一个新的阅读模式

1. 在 `readerStore.ts` 的 `readingMode` 类型中新增值
2. 在 `ReaderView.tsx` 中根据新模式切换渲染逻辑
3. 在 `InnerReaderHeader.tsx` 的下拉菜单中新增选项
4. 在 `BottomNav.tsx` 中调整翻页逻辑

---

## 附录：文件修改热度（最近提交）

```
最近 10 次提交修改的文件（按频率排序）：

5 次 — backend/app/prompts/knowledge_animation.md        ← 动画 prompt 迭代
3 次 — app/app/components/reader/KnowledgeAnimationModal.tsx  ← 播放器修复
2 次 — backend/app/services/knowledge_animation_service.py    ← HTML 提取器
1 次 — app/app/read/[bookName]/page.tsx                      ← finally 安全网
1 次 — HANDOVER.md                                           ← 本批次新增
1 次 — ARCHITECT_GUIDE.md                                    ← 本批次新增
```

**结论**：动画子系统是近期最高频改动区域，建议优先稳定该部分后再扩展其他功能。
