# Deploying

Aftershock has three processes (api, worker, web) plus Postgres 16 and
Redis 7.

## Free: Vercel for the website, Oracle Cloud for everything else

The website is static and lives on Vercel. The api, the worker, Postgres, and
Redis run together on one Oracle Cloud Always Free VM (an always-on ARM
machine, up to 4 cores and 24 GB), with Caddy serving HTTPS. Vercel forwards
`/api` requests and page requests (for link previews) to the VM; the live map
opens its WebSocket straight to the VM, because Vercel does not forward
WebSockets. Total cost: nothing, until you add a domain.

Why not a serverless host for the engine: the worker polls the NHL every few
seconds for hours and keeps the live season in memory, and the api holds a
WebSocket per visitor. Free serverless and sleeping instances stop both.

### 1. Oracle Cloud VM

1. Sign up at cloud.oracle.com (a card is asked for verification; Always
   Free resources are not charged). Pick a home region near the US east coast
   or central US; it cannot be changed later.
2. Compute, Instances, Create instance: image Canonical Ubuntu 24.04, shape
   `VM.Standard.A1.Flex` with 4 OCPUs and 24 GB (or 2 and 12). Add your SSH
   public key. If A1 capacity is out in your region, retry later or pick
   another availability domain.
3. Networking, the instance's subnet, its security list: add ingress rules
   for TCP 80 and TCP 443 from `0.0.0.0/0`. If A1 capacity is out, upgrading
   the account to Pay As You Go helps; Always Free resources stay free.
   If the instance shows no public IP, open its primary VNIC, IP
   administration, edit the private IP, and choose an ephemeral public IP.
4. Note the instance's public IP. The api host until you buy a domain is
   `<IP>.sslip.io` (a free name that points at the IP and can get an HTTPS
   certificate).

### 2. Point the website at the VM

On your laptop, in the repo:

```sh
scripts/set_api_host.sh <IP>.sslip.io     # writes vercel.json
git add vercel.json && git commit -m "Point the website at the api host" && git push
```

### 3. Vercel

1. vercel.com, Add New Project, import `yasher3413/Aftershock`. Leave the
   root directory as the repo root and the framework as Other; `vercel.json`
   has the build (it installs Rust to build the What-If simulator, so the
   first build takes a few minutes). If the import page insists on
   "Services", use the CLI instead: `vercel link --yes --project aftershock`,
   `vercel env add VITE_WS_URL production`, `vercel git connect`, then push.
2. Environment variables: `VITE_WS_URL` = `wss://<IP>.sslip.io/ws/live`.
3. Deploy, and note the site address, for example `https://aftershock.vercel.app`.

### 4. Start the engine on the VM

```sh
ssh ubuntu@<IP>
curl -fsSL https://raw.githubusercontent.com/yasher3413/Aftershock/main/scripts/deploy/oracle_bootstrap.sh | bash -s -- https://aftershock.vercel.app
```

It installs Docker, opens the VM's firewall, writes `.env` (random database
password, the api host, the site address), and builds and starts Postgres,
Redis, the api, the worker, and Caddy. Add `OPENAI_API_KEY` to `~/Aftershock/.env`
for model-written recaps, then
`sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env up -d`.

### 5. Copy the data

From your laptop (Postgres running locally on port 55432):

```sh
scripts/deploy/push_data.sh ubuntu@<IP>
```

### 6. Check

- `https://<IP>.sslip.io/api/health` answers.
- The site loads, the map fills in, and `/status` shows the worker running.
- Paste a team or tremor link into an Open Graph preview checker and see the
  image card.

### Later

- **Capacity:** `API_WORKERS` in the VM's `.env` sets the api processes
  (default 2; about one per core). Read responses are cached for seconds at
  Vercel's CDN and in each process (`services/aftershock/api/cache.py`).
- **Updates:** Vercel redeploys on every push. On the VM:
  `cd ~/Aftershock && git pull && sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env up -d --build`.
- **A domain:** add it to the Vercel project for the site, point `api.<domain>`
  at the VM's IP with an A record, then set `API_HOST=api.<domain>`,
  `PUBLIC_BASE_URL=https://<domain>`, and `INDEX_HTML=https://<domain>/app.html`
  in the VM's `.env`, rerun `scripts/set_api_host.sh api.<domain>`, and set
  `VITE_WS_URL=wss://api.<domain>/ws/live` in Vercel.

## Other hosts

## What the owner needs

- A Fly.io account and `flyctl` logged in (for the api, the worker, and
  Postgres).
- An Upstash Redis database (or Fly's Redis offering), for pub/sub.
- A Cloudflare account with Pages enabled (for the web app), or serve the web
  image from Fly as well.
- Optional: an `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` for model-written
  recaps (without one the deterministic template is used). The worker makes
  one call per night; visitors only read the stored recap.
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
| `OPENAI_API_KEY`, `OPENAI_RECAP_MODEL` | worker | optional; model default `gpt-6.1-sol`; used when set |
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
fly secrets set --app aftershock-worker REDIS_URL=... OPENAI_API_KEY=...
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
