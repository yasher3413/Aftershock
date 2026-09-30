# Aftershock: single entry point for development.
SHELL := /bin/bash
UV ?= uv
COMPOSE := docker compose -f infra/docker-compose.yml --env-file .env
PY := cd services && $(UV) run
# macOS: Homebrew's Cairo is not on the default library path (share images).
export DYLD_FALLBACK_LIBRARY_PATH := $(DYLD_FALLBACK_LIBRARY_PATH):/opt/homebrew/lib
SEASON ?= 20252026

.PHONY: help setup env up down dev db-up migrate native wasm types test test-rust test-py test-web \
	lint fmt bench bootstrap-lite backfill train precompute screenshots e2e style geo

help: ## List targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

env: ## Create .env from .env.example if missing
	@test -f .env || cp .env.example .env

setup: env ## Install toolchains and dependencies
	@command -v cargo >/dev/null || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
	@command -v $(UV) >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
	@command -v pnpm >/dev/null || npm i -g pnpm
	@command -v wasm-pack >/dev/null || cargo install wasm-pack
	rustup target add wasm32-unknown-unknown
	cd services && $(UV) sync
	$(MAKE) native
	cd web && pnpm install
	$(MAKE) wasm

native: ## Build the PyO3 simulator extension into the Python env
	cd services && $(UV) run maturin develop --release -m ../crates/aftershock-py/Cargo.toml

wasm: ## Build the WASM simulator for the web app
	wasm-pack build crates/aftershock-wasm --release --target web --out-dir ../../web/src/wasm/pkg

db-up: env ## Start Postgres and Redis only
	$(COMPOSE) up -d postgres redis

migrate: ## Apply database migrations
	$(PY) alembic upgrade head

up: env ## Start the full stack at http://localhost:8080
	$(COMPOSE) --profile app up -d --build

down: ## Stop the stack
	$(COMPOSE) --profile app down

dev: db-up migrate ## Hot reload api, worker, and web
	@trap 'kill 0' EXIT; \
	(cd services && $(UV) run uvicorn aftershock.api.app:create_app --factory --reload --port 8000) & \
	(cd services && $(UV) run aftershock worker) & \
	(cd web && pnpm dev) & \
	wait

types: ## Regenerate TypeScript API types from pydantic models
	$(PY) aftershock export-schema ../web/src/api/schema.json
	cd web && pnpm types

test: test-rust test-py test-web ## Run all tests

test-rust:
	cargo test --workspace

test-py:
	$(PY) pytest

test-web:
	cd web && pnpm test

lint: style ## Lint everything
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings
	$(PY) ruff check .
	$(PY) ruff format --check .
	$(PY) mypy aftershock
	cd web && pnpm lint && pnpm typecheck && pnpm format:check

fmt: ## Format everything
	cargo fmt --all
	$(PY) ruff format .
	$(PY) ruff check --fix .
	cd web && pnpm format

style: ## Check for em dashes in tracked files
	python3 scripts/check_no_em_dash.py --all

bench: ## Run simulator benchmarks
	cargo bench -p aftershock-core

bootstrap-lite: db-up migrate ## Load 2024-25 onward, precompute 2025-26 tremors and replays
	$(PY) aftershock bootstrap-lite

backfill: db-up migrate ## Full historical backfill (2015-16 onward)
	$(PY) aftershock backfill --from-season 20152016

train: ## Train all models and write eval reports, then the season backtest
	$(PY) aftershock train all
	$(PY) aftershock backtest

precompute: ## Precompute tremors for SEASON (default 20252026), refitting magnitude
	$(PY) aftershock precompute --season $(SEASON)

geo: ## Rebuild the basemap from Natural Earth
	bash scripts/build_geo.sh

e2e: ## Playwright end-to-end tests
	cd web && pnpm e2e

screenshots: ## Capture README screenshots and the hero GIF
	cd web && SCREENSHOTS=1 pnpm exec playwright test e2e/screenshots.spec.ts
	bash scripts/make_gif.sh
