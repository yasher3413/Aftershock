# API image: FastAPI with uvicorn. Shares the worker's build so both run the
# same code; the API never calls the simulator, but the migrations and
# share-image fonts live here too.
FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends libcairo2 libgomp1 fontconfig \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /bin/uv
WORKDIR /app/services
COPY services/pyproject.toml services/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services ./
RUN uv sync --frozen --no-dev
COPY services/aftershock/share/fonts /usr/share/fonts/truetype/aftershock
RUN fc-cache -f >/dev/null
COPY config /app/config
COPY ml /app/ml
ENV PATH="/app/services/.venv/bin:$PATH" DATA_DIR=/app/data
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn aftershock.api.app:create_app --factory --host 0.0.0.0 --port 8000 --proxy-headers"]
