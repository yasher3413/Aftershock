# Deploying

Puckquake has three processes (api, worker, web) plus Postgres 16 and
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

This copies the database, the replay bundles, and the model inputs the
worker needs to rate teams: `data/features` (the games table) and this
season's raw play-by-play. Without the inputs the worker logs
`ratings.games_table_missing` and every odds is wrong. From your laptop
(Postgres running locally on port 55432):

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
- **Updates:** Vercel redeploys on every push. Each build carries forward the
  previous two deploys' hashed asset files (`scripts/vercel_build.sh`), so a
  page shell cached before the deploy still loads; nothing to do by hand. On
  the VM, for api or worker changes:
  `cd ~/Aftershock && git pull && sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env up -d --build`.
- **Model changes:** after a change to the strength model or its inputs
  (including `config/market/point_totals.json`), recompute ratings and restart
  the worker so the live odds and the What-If Lab use it:
  `sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env exec -T worker aftershock ratings`,
  then `... restart worker`. Retrain locally first (`make train`,
  `aftershock backtest`) and commit `ml/artifacts` and `ml/reports`.
- **Every October:** add the new season's preseason point totals to
  `config/market/point_totals.json` (from Hockey-Reference's preseason odds
  page) before opening night, deploy, and recompute ratings as above. Without
  them the model skips that prior for the season.
- **Model update markers:** when a model change moves the live odds, add an
  entry to `web/src/lib/modelChanges.ts` so team odds charts mark the step.
- **The domain** (2026-10-24): www.puckquake.com is the Vercel production
  domain and puckquake.com redirects to it. The api is api.puckquake.com (an
  A record at Namecheap to the VM's IP); Caddy also still answers on the old
  sslip.io name, so both work: the VM's `.env` has
  `API_HOST="api.puckquake.com, 140.238.146.151.sslip.io"`,
  `PUBLIC_BASE_URL=https://www.puckquake.com`, and
  `INDEX_HTML=https://www.puckquake.com/app.html`. Vercel has
  `VITE_WS_URL=wss://api.puckquake.com/ws/live`, and `vercel.json` sends
  `/api`, page paths, robots, and the sitemap to api.puckquake.com. After
  changing `.env`, recreate the containers with `up -d` (`restart` keeps the
  old values). To change the api host again, run
  `scripts/set_api_host.sh <host>` (it fills `vercel.template.json`, which
  must stay in step with `vercel.json`), set `VITE_WS_URL` in Vercel, and
  update `API_HOST`.

## Goal bot on X

The worker can post every regular-season goal to X as @puckquake: the story,
both teams' playoff odds before and after, and the goal's share card. It
deletes the post if the goal is overturned and replies with a one-line
correction if the scorer or assists change. It ships switched off. Design:
`docs/superpowers/specs/2026-10-23-goal-bot-design.md`; code:
`services/aftershock/bot/`.

1. **The account.** Create the X account (@puckquake, or the closest free
   handle) with its own email. In its settings, label it as automated
   (Settings, Your account, Account information, Automation) and pick your
   personal account as the managing account. Bio: "Every NHL goal is an
   earthquake. A post for each one, showing how far it moved the playoff
   race. Automated · Not affiliated with the NHL · puckquake.com".
2. **Developer access.** Signed in as the bot account, open
   console.x.com (the X developer console), sign up for pay-per-use, and
   create a project and an app. In the app's user authentication settings
   choose OAuth 1.0a with **Read and write** permissions (any callback URL,
   for example https://www.puckquake.com). Then, under Keys and tokens,
   copy the **API key and secret** and generate an **access token and
   secret** for the bot account itself. Generate the access token after
   setting Read and write, or it will be read-only.
3. **Credits.** Buy credits in the console (posts are prepaid). At the
   prices checked on 2026-10-23, a post is $0.015 and an image upload
   $0.005, so a season is about $25 a month; check the current prices
   first. Posts carry no links because a post with a link costs $0.20.
4. **Keys.** On the VM, add to `~/Aftershock/.env`:
   ```
   X_API_KEY=...
   X_API_SECRET=...
   X_ACCESS_TOKEN=...
   X_ACCESS_SECRET=...
   ```
   Optional: `X_BOT_MONTHLY_CAP_MILLICENTS` (tenths of a cent, default
   40000 = $40). At the cap the bot stops posting until the next month and
   logs `bot.cap_reached`. Then recreate the worker so it reads them:
   `sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env up -d --build worker`.
5. **Dry run for a full night.** Switch the bot to dry run (it writes each
   post to the log and the `bot_posts` table without calling X):
   `sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env exec -T worker aftershock bot-mode dry_run`.
   During games, read what it would have posted:
   `sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env logs -f worker | grep bot.`
   (`bot.post` lines carry the text; `bot.skip` says why a goal was not
   posted).
6. **Go live.** `... exec -T worker aftershock bot-mode live`. The command
   prints the mode in effect; `live` without all four keys stays `off`.
7. **Switch off** at any time: `... exec -T worker aftershock bot-mode off`.
   `aftershock bot-mode` with no argument shows the mode. The switch is a
   Redis key (`aftershock:bot:mode`), so it needs no redeploy and outlasts
   restarts; `X_BOT_MODE` in `.env` is only the default when the key is
   unset.

What it skips: preseason and playoff games, overturned goals, and any goal
more than 15 minutes old when it would post (so a restart or a catch-up
never sends a burst of old goals). Each goal is posted at most once. If X is
rate limiting or down, it retries for about three minutes, then gives up on
that goal (`bot.gave_up`). Spending so far this month is the Redis key
`aftershock:bot:spend:YYYY-MM`, in tenths of a cent.

## Roster Lab

The Roster Lab needs two new tables, the player values, and a What-If
bootstrap that carries the simulation ratings. On the VM, after pulling and
rebuilding (`up -d --build` runs `alembic upgrade head` in the api):

```sh
cd ~/Aftershock
sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env exec -T worker \
  aftershock player-values --season 20242025 --season 20252026 --season 20262027
sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env restart worker
```

The first run fetches any shift charts and play-by-play the VM does not have
yet (about 2,600 games from 2024-25 on), so it takes a while; later runs
happen in the worker's 06:00 Eastern step and only read what is cached. The
ridge penalty is stored in `ml/artifacts/roster-1.0.0.json`; refit it on a
laptop with `--refit-alpha` and check the result with
`aftershock roster-check --season 20262027` before committing it. Until the
worker restarts, `/api/roster-lab/*` answers `409` (the bootstrap has no
ratings yet) and the page shows its offseason note.

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
