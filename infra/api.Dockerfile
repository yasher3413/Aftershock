# API image: FastAPI with uvicorn. Shares the worker's build so both run the
# same code, and the migrations and share-image fonts live here too. The
# simulator is built the same way as the worker's (Docker reuses that stage)
# for the What-If scenario preview images.
FROM python:3.12-slim-bookworm AS core
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
ENV PATH="/root/.cargo/bin:$PATH"
RUN python -m venv /tools && /tools/bin/pip install -q "maturin>=1.7,<2"
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY config config
RUN /tools/bin/maturin build --release -m crates/aftershock-py/Cargo.toml -o /wheels -i python3.12

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
COPY --from=core /wheels /wheels
RUN uv pip install --python .venv/bin/python /wheels/*.whl
COPY services/aftershock/share/fonts /usr/share/fonts/truetype/aftershock
RUN fc-cache -f >/dev/null
COPY config /app/config
COPY ml /app/ml
ENV PATH="/app/services/.venv/bin:$PATH" DATA_DIR=/app/data
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn aftershock.api.app:create_app --factory --host 0.0.0.0 --port 8000 --proxy-headers"]
