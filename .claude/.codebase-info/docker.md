# Docker

*Last Updated: 2026-09-21*

## Image (`docker/Dockerfile`, multi-stage)

| Stage | Purpose |
|---|---|
| `monolith_builder` | Rust build of `monolith` (page archiver used by the crawler) |
| `base` | node 24 slim + pnpm; install + build workspace |
| `aio_builder` | runtime layout: Next standalone web + bundled workers (`tsdown`), s6-overlay, yt-dlp, etc. Exposes 3000 |
| `aio` | **default published image**: web + workers + migrations in one container |
| `web` / `workers` | legacy split images (`USING_LEGACY_SEPARATE_CONTAINERS=true`) |
| `cli` | standalone CLI image (`node index.mjs`) |
| `mcp` | standalone MCP server image (`node index.js`) |

The s6-overlay services live in `docker/root/etc/s6-overlay/s6-rc.d/`: `init-db-migration` (oneshot) → `svc-web` + `svc-workers` (both depend on migration).

`docker/chrome/` builds the `karakeep-chrome` headless-browser image used for crawling.

## Compose files

| File | Use |
|---|---|
| `docker/docker-compose.yml` | Production-style: `web` (AIO image), `chrome`, `meilisearch`; volumes `data`, `meilisearch` |
| `docker/docker-compose.dev.yml` | Dev: `web` + `workers` from `Dockerfile.dev` with source mounted, `prep` (install/migrate), `chrome`, `meilisearch` |
| `docker/docker-compose.build.yml` | Build the image locally |
| `packages/e2e_tests/docker-compose.yml` | E2E test stack |

Garage (S3-compatible) config for local S3 testing is in `docker/garage/garage.toml`. The env template is `docker/.env.sample`.

## Local dev without full Docker

`start-dev.sh` checks for docker and pnpm, starts a Meilisearch container on :7700 (and a Chrome container), then starts the web app and workers with pnpm. Minimum env (`.env.sample`): `DATA_DIR`, `NEXTAUTH_SECRET`. Crawling needs `BROWSER_WEB_URL`, search needs `MEILI_ADDR`, and AI needs `OPENAI_API_KEY` or `OLLAMA_BASE_URL`.
