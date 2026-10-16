# API image. Vision dependencies (torch, model) are deliberately excluded: detection runs on-site.
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.0 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY turnwise ./turnwise
COPY config ./config
# The recorded replay's timeline and camera manifest, read by /api/demo.
COPY demo ./demo
EXPOSE 8000
# One process only: the API keeps the outlet state in memory and is the single Firestore writer.
CMD ["uv", "run", "--no-sync", "uvicorn", "turnwise.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
