# Web image: build the WASM simulator and the Vite app, serve with nginx.
FROM rust:1-slim-bookworm AS wasm
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* && rustup target add wasm32-unknown-unknown \
    && curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates crates
COPY config config
RUN wasm-pack build crates/aftershock-wasm --release --target web --out-dir /pkg

FROM node:24-slim AS build
RUN corepack enable
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./
COPY --from=wasm /pkg src/wasm/pkg
RUN pnpm build

FROM nginx:1.27-alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist /usr/share/nginx/html
EXPOSE 8080
