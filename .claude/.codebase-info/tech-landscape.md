# Tech Landscape

*Last Updated: 2026-09-21*

## Languages and runtimes

- **TypeScript** everywhere. Node **24** (the Docker base is `node:24.x-slim`).
- **pnpm 11** workspaces (`pnpm-workspace.yaml`, with `nodeLinker: hoisted`), orchestrated by **Turborepo 2** (`turbo.json`).
- A small **Rust** build stage compiles `monolith` (single-file page archiver) in `docker/Dockerfile`.

## Stack by layer

| Layer | Tech | Where |
|---|---|---|
| Web UI | Next.js 16 (App Router), React 19.2, Tailwind 3, shadcn/ui, TanStack Query 5, zustand, i18next | `apps/web` |
| HTTP API | Hono 4, `@hono/zod-validator`, `@hono/otel` | `packages/api` |
| RPC / business logic | tRPC 11 + superjson, zod 4 | `packages/trpc` |
| Auth | next-auth v4 (credentials + OAuth/OIDC), Drizzle adapter, API keys | `apps/web/server/auth.ts`, `packages/trpc/auth.ts` |
| DB | SQLite via better-sqlite3 + Drizzle ORM 0.45 / drizzle-kit | `packages/db` |
| Queues | liteque (SQLite-backed, default) or Restate | `packages/plugins/queue-*` |
| Search | Meilisearch (full-text); Meilisearch vector store for semantic search | `packages/plugins/search-meilisearch`, `vectorstore-meilisearch` |
| Assets | local filesystem or S3 | `packages/plugins/assetstore-*` |
| Rate limiting | in-memory or Redis | `packages/plugins/ratelimit-*` |
| Crawling | Playwright (+ playwright-extra), remote Chrome over CDP, metascraper, Readability, monolith, yt-dlp, autoconsent/adblocker | `apps/workers/workers/crawler/*` |
| AI inference | OpenAI SDK (and any OpenAI-compatible base URL), Ollama | `packages/shared/inference.ts` |
| OCR / assets | tesseract.js, sharp, PDF handling | `apps/workers/workers/assetPreprocessingWorker.ts` |
| Observability | OpenTelemetry tracing + event logs, prom-client metrics | `packages/shared-server/src/tracing.ts`, `eventLogger.ts`, `packages/trpc/stats.ts` |
| Billing (optional) | Stripe subscriptions + quotas | `packages/trpc/routers/subscriptions.ts`, `shared-server/src/services/quotaService.ts` |
| Mobile | Expo 56 / React Native 0.85, expo-router, NativeWind | `apps/mobile` |
| Extension | Vite + React, Manifest V3, SingleFile | `apps/browser-extension` |
| CLI | commander-style CLI via tRPC client, built with Vite | `apps/cli` |
| MCP | `@modelcontextprotocol/server` + `@karakeep/sdk` | `apps/mcp` |
| Landing | Astro | `apps/landing` |
| Docs | Docusaurus (versioned) | `docs/` |

## Tooling

- **Formatting:** oxfmt (`.oxfmtrc.json`). Import sorting and Tailwind class sorting are built into oxfmt.
- **Linting:** oxlint (`tooling/oxlint/oxlint-{base,react,nextjs}.json`, with per-package `.oxlintrc.json`).
- **Tests:** Vitest (unit tests per package; `packages/e2e_tests` uses docker-compose).
- **Type configs:** `tooling/typescript` (`@karakeep/tsconfig`).
- **Monorepo hygiene:** `sherif` checks consistent dependency versions. Husky provides git hooks.
- Patched deps live in `patches/` (react-tweet, xcode, playwright-extra, expo-modules-jsi, react-native).

## Source-of-truth files

| Concern | File |
|---|---|
| Workspace list, patches, overrides, pinned React | `pnpm-workspace.yaml` |
| Task graph | `turbo.json` |
| Root scripts | `package.json` |
| All server env vars (zod-validated) | `packages/shared/config.ts` |
| DB schema | `packages/db/schema.ts` → migrations in `packages/db/drizzle/` |
| Public REST contract | `packages/open-api/karakeep-openapi-spec.json` (generated from `packages/open-api/lib/*`) |
| User-facing config docs | `docs/docs/03-configuration/` |
| Env sample | `.env.sample`, `docker/.env.sample` |

## Notable dependency constraints

- `react`, `react-dom`, and `@types/react` are pinned **workspace-wide** through `overrides` because React Native asserts an exact React version. Bump them together with Expo.
- `pnpm-workspace.yaml` has a `minimumReleaseAgeExclude` list. New releases are otherwise held back.
