FROM python:3.12-slim

WORKDIR /app

# ── System dependencies ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies (Tsinghua mirror for mainland speed) ──
COPY requirements.txt .
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple/ && \
    pip install --no-cache-dir -r requirements.txt && \
    pip config unset global.index-url

# ── Application code ──
COPY . .

# ── Verify toolchain ──
RUN rg --version && python -c "import pymupdf4llm; print('pymupdf4llm OK')" && python -c "import fitz; print('pymupdf OK')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
