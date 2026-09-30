# Worker image: the Python service plus the compiled Rust simulator.
FROM rust:1-slim-bookworm AS core
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 python3-dev python3-venv \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /tools && /tools/bin/pip install -q maturin==1.*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
RUN /tools/bin/maturin build --release -m crates/aftershock-py/Cargo.toml -o /wheels -i python3

FROM python:3.12-slim-bookworm AS app
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
COPY tests/fixtures /app/tests/fixtures
ENV PATH="/app/services/.venv/bin:$PATH" DATA_DIR=/app/data
CMD ["aftershock", "--json-logs", "worker"]
