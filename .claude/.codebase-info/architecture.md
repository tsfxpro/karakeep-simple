# Architecture

*Last Updated: 2026-09-21*

## Runtime processes

A deployment runs two Node processes that share a SQLite data directory (`DATA_DIR`). There are also optional external services.

```
             ┌──────────────── clients ────────────────┐
             │ browser UI · mobile (Expo) · extension  │
             │ CLI · MCP server · SDK / REST users     │
             └───────────────┬─────────────────────────┘
                             │ HTTP  /api/trpc/*  /api/v1/*
┌────────────────────────────▼──────────────────────────────┐
│ apps/web  (Next.js, port 3000)                            │
│  app/api/[[...route]]/route.ts ─► packages/api (Hono)     │
│     /api/trpc ─► packages/trpc appRouter                  │
│     /api/v1   ─► REST routes ─► tRPC caller               │
│  React UI ─► tRPC client (TanStack Query)                 │
│  next-auth sessions (apps/web/server/auth.ts)             │
└──────┬──────────────────────────────┬─────────────────────┘
       │ Drizzle (better-sqlite3)     │ enqueue (plugin queue)
┌──────▼──────────┐          ┌────────▼─────────────────────┐
│ DATA_DIR/db.db  │◄─────────│ apps/workers  (port 3001)    │
│ (+ queue.db for │  Drizzle │ crawler · inference · search │
│  liteque)       │          │ embeddings · video · feed ·  │
└─────────────────┘          │ webhook · ruleEngine · backup│
                             │ assetPreprocessing · import  │
                             └──┬──────────┬───────────┬────┘
                                │          │           │
                    headless Chrome   OpenAI/Ollama   Meilisearch
                    (Playwright/CDP)  (inference.ts)  (search + vectors)
```

- **Web** (`apps/web`): renders the UI and hosts the entire HTTP API in-process. It does not run background jobs. It only enqueues them.
- **Workers** (`apps/workers/index.ts`): pull jobs from queues and write results back to the DB. The workers call tRPC procedures in-process through an impersonating caller (`apps/workers/trpc.ts`). They also expose `/health` and `/metrics` on their own small Hono server (`apps/workers/server.ts`).
- In Docker, both processes run in one "AIO" image under s6-overlay. A DB-migration init step runs first. See [docker.md](docker.md).

## Layering

```
clients ─► packages/api (Hono REST, auth, rate limit, scopes)
            └► packages/trpc  routers/*  (validation + authz via zod + middleware)
                 └► packages/trpc  models/*  (domain classes / repos / services)
                      └► packages/db  (Drizzle schema + client)
                 └► packages/shared-server  (queues, asset store, event log, tracing, quota)
                      └► packages/shared  (config, types/zod schemas, plugin interfaces, inference, search parser)
                      └► packages/plugins  (concrete backends, loaded at runtime)
```

- `packages/shared` is isomorphic. Clients import it for zod types. `prompts.server.ts` and `config.ts` are server-only in practice.
- `packages/shared-server` is server-only glue. It holds the lazily initialized queues and the plugin loader.
- `packages/shared-react` has React hooks built on tRPC and TanStack Query. Web and mobile share them.

## Key flow: saving a link

1. The client calls `bookmarks.createBookmark` (tRPC), or sends `POST /api/v1/bookmarks` (REST, which calls the same procedure).
2. `packages/trpc/routers/bookmarks.ts` checks quota and dedups, then inserts rows (`bookmarks`, `bookmarkLinks`).
3. The procedure enqueues `LinkCrawlerQueue`, or `LowPriorityCrawlerQueue` for imports. For text it enqueues `OpenAIQueue` + `EmbeddingsQueue`. For assets it enqueues `AssetPreprocessingQueue`. Then it calls `RuleEngine.triggerOnEvent(bookmarkAdded)`, `triggerSearchReindex`, and the `created` webhook.
4. Workers take over. The crawler fetches the page, extracts metadata and readable content, and stores screenshots and archives. It then enqueues inference (tagging and summary), embeddings, video download, and search reindex. Tagging fires rule-engine events and webhooks. The full graph is in [workers.md](workers.md).

## Other flows

- **Search**: `bookmarks.searchBookmarks` → `packages/trpc/lib/search.ts`. It parses the query language (`packages/shared/searchQueryParser.ts`), matches filters in SQL, and does full-text through the Search plugin (Meilisearch). Semantic search goes through the VectorStore plugin when enabled. Ranking logic is in `lib/searchRanking.ts`.
- **Auth**: next-auth (credentials + optional OAuth/OIDC) issues sessions for the UI. API keys (`Authorization: Bearer`) serve every other client. `createContextFromRequest` in `apps/web/server/api/client.ts` resolves both.
- **Public lists / RSS**: `routers/publicBookmarks.ts`, `packages/api/routes/public.ts`, `routes/rss.ts`.
- **Import/Export**: `packages/shared/import-export/*` parses and exports. The import worker polls `importSessions` and `importStagingBookmarks`.

## Boundaries worth knowing

- Server-only config (`@karakeep/shared/config`) is read from env via zod at import time. Client-visible config is exposed through `routers/config.ts` and `ClientConfigProvider`.
- Read-only and degraded modes (`packages/shared/readOnlyMode.ts`) block mutations globally at the base `procedure`, and also in Hono (`middlewares/readOnlyMode.ts`).
- Multi-tenant: every query is scoped by `userId`. Ownership checks are procedure middlewares (e.g. `ensureBookmarkOwnership`). Lists have collaborators (`listCollaborators`) with roles.
