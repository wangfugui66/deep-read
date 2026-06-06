"""DeepRead-v2 — FastAPI application entry point.

Zero database dependencies. All state is in Markdown files under data/.
"""

from pathlib import Path

# Load .env with absolute path — immune to CWD drift.
# Must execute BEFORE any service imports that read os.environ.
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=_env_path)
except ImportError:
    # python-dotenv not installed — rely on system env vars / IDE injection
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .master_router import router
from .resource_router import resource_router
from .plugins_router import plugins_router

app = FastAPI(
    title="DeepRead-v2",
    description="AI 深度阅读助手 — 文件系统即数据库架构",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(resource_router)
app.include_router(plugins_router)

# ── Log prompt signatures at startup ──
try:
    from .services.prompts import FEYNMAN_GUIDE_PROMPT, ARCHITECT_TOC_PROMPT
    print(f"\n{'='*60}")
    print("FEYNMAN_GUIDE_PROMPT loaded — preview:")
    print(f"{'='*60}")
    print(FEYNMAN_GUIDE_PROMPT[:300])
    print(f"\n{'='*60}")
    print("ARCHITECT_TOC_PROMPT loaded — preview:")
    print(f"{'='*60}")
    print(ARCHITECT_TOC_PROMPT[:300])
    print(f"{'='*60}\n")
except Exception as e:
    print(f"[deepread] Failed to load prompts: {e}")


@app.get("/")
async def root():
    return {"service": "DeepRead-v2", "version": "2.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
