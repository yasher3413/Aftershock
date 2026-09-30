# Deploying

Aftershock has three processes (api, worker, web) plus Postgres 16 and
Redis 7. Nothing here has been deployed; this guide is what the owner needs to
do, and it lists every credential required.

## What the owner needs

- A Fly.io account and `flyctl` logged in (for the api, the worker, and
  Postgres).
- An Upstash Redis database (or Fly's Redis offering), for pub/sub.
- A Cloudflare account with Pages enabled (for the web app), or serve the web
  image from Fly as well.
- Optional: an `ANTHROPIC_API_KEY` for model-written recaps (without it the
  deterministic template is used).
- A domain, if you want one; set `PUBLIC_BASE_URL` to it.

## Environment

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | api, worker | `postgresql+asyncpg://...` |
| `REDIS_URL` | api, worker | `redis://...` or `rediss://...` |
| `NHL_API_BASE` | worker | default `https://api-web.nhle.com/v1` |
| `POLL_LIVE_SECONDS`, `POLL_SCORE_SECONDS` | worker | defaults 5 and 30 |
| `SIM_N` | worker | simulations per run, default 20000 |
| `SIM_N_BACKFILL` | jobs | default 5000 |
| `DEMO_MODE` | worker | `auto` (default), `on`, or `off` |
| `ANTHROPIC_API_KEY`, `RECAP_MODEL` | worker | optional; model default `claude-sonnet-5-5` |
| `PUBLIC_BASE_URL` | api | absolute URLs in share metadata |
| `DATA_DIR` | api, worker | where replay bundles and the raw cache live |

## Fly.io (api, worker, Postgres)

```sh
fly launch --no-deploy --name aftershock-api --dockerfile infra/api.Dockerfile
fly postgres create --name aftershock-db --region yyz
fly postgres attach aftershock-db --app aftershock-api
fly volumes create aftershock_data --app aftershock-api --size 5
fly secrets set --app aftershock-api REDIS_URL=... PUBLIC_BASE_URL=https://...
fly deploy --app aftershock-api
```

Then the worker, sharing the database and a data volume:

```sh
fly launch --no-deploy --name aftershock-worker --dockerfile infra/worker.Dockerfile
fly postgres attach aftershock-db --app aftershock-worker
fly volumes create aftershock_data --app aftershock-worker --size 5
fly secrets set --app aftershock-worker REDIS_URL=... ANTHROPIC_API_KEY=...
fly scale count 1 --app aftershock-worker   # one leader; a second would wait on the lock
fly deploy --app aftershock-worker
```

Rewrite `postgres://` URLs from `fly postgres attach` to
`postgresql+asyncpg://`. The api container runs `alembic upgrade head` on
start.

Seed history once, from the worker machine:

```sh
fly ssh console --app aftershock-worker -C "aftershock bootstrap-lite"
```

Replay bundles are written to the worker's volume; copy `data/replays` to
the api's volume (or mount shared storage such as Tigris and point
`DATA_DIR` at it) so `/api/replay/{date}` can serve them.

## Cloudflare Pages (web)

```sh
make wasm
cd web && pnpm build
npx wrangler pages deploy dist --project-name aftershock
```

Add a Pages Function or a Cloudflare redirect so `/api/*` and `/ws/*` proxy
to the Fly api (`https://aftershock-api.fly.dev`). The WebSocket needs the
`Upgrade` header forwarded; Pages Functions pass it through. The single-page
app needs a fallback of every unknown path to `index.html` (Pages does this
by default when there is no `404.html`).

## Single machine

`make up` runs everything from `infra/docker-compose.yml` on one host at port
8080, with nginx proxying `/api` and `/ws`. This is the simplest deployment:
put it behind any TLS-terminating proxy.
