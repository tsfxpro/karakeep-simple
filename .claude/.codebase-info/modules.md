# Modules

*Last Updated: 2026-09-21*

Every workspace package is scoped `@karakeep/<name>`. Packages mostly export raw TS through subpath imports (e.g. `@karakeep/trpc/routers/_app`, `@karakeep/shared/types/bookmarks`). Nothing is pre-built for internal consumption.

## packages/trpc: business logic

- `index.ts`: tRPC init (superjson, error formatter), base `procedure` (read-only guard, metrics, tracing), `publicProcedure`, `authedProcedure`, admin procedures, API-key scope enforcement, and the `Context` / `AuthedContext` types.
- `routers/*`: the API surface. They hold zod input/output and ownership middleware, and delegate to models.
- `models/*`: domain logic. Two styles coexist:
  - **Class models**: `bookmarks.ts` (`BareBookmark`, `Bookmark`), `lists.ts`, `tags.ts`, `users.ts`, `rules.ts`, `assets.ts`, `backups.ts`, `listInvitations.ts`.
  - **Repo + service split** (newer): `feeds.repo.ts`/`feeds.service.ts`, `highlights.*`, `importSessions.*`, `webhooks.*`. The repo handles DB access and the service handles logic and authz.
- `lib/`: `search.ts` + `searchRanking.ts` (query execution), `ruleEngine.ts` (evaluate rules → actions; enqueues `RuleEngineQueue`), `rateLimit.ts`, `impersonate.ts` (worker contexts), `attachments.ts`, `linkPreview.ts`, `turnstile.ts`, `eventLog.ts`, `actor.ts`, `tracing.ts`.
- `auth.ts`: password hashing and validation, API key generation and authentication. `email.ts`: SMTP emails. `stats.ts`: prom-client metrics.
- `testUtils.ts`: in-memory DB + queue mocks for router tests.

## packages/api: Hono HTTP layer

- `index.ts` assembles the app. `routes/*` are REST v1 routes, and `middlewares/` holds `auth.ts` (sets `c.var.api` = tRPC caller), `apiKeyScopes.ts`, `rateLimit.ts`, `readOnlyMode.ts`, and `trpcAdapter.ts` (maps TRPCError → HTTP status).
- `utils/`: pagination adapters, upload handling, readable-content chunking, RSS generation.

## packages/db

- `schema.ts` (all tables + relations), `drizzle.ts` (exports `db`, `getInMemoryDB`), `sqlite.ts` (open with WAL/read-only), `instrumentation.ts` (tracing), `migrate.ts`, `drizzle/` migrations. See [database.md](database.md).

## packages/shared: isomorphic core

- `config.ts`: zod-parsed env → `serverConfig` (default export) and `clientConfig`.
- `types/*.ts`: zod schemas shared by server and clients (`zBookmarkSchema`, `zNewBookmarkRequestSchema`, …).
- Plugin interfaces: `plugins.ts` (`PluginManager`, `PluginType`), `queueing.ts`, `search.ts`, `assetdb.ts`, `ratelimiting.ts`, `vectorStore.ts`.
- `inference.ts` (OpenAI/Ollama clients), `prompts.ts` / `prompts.server.ts` (tagging and summary prompts), `searchQueryParser.ts` (search DSL), `import-export/` (Netscape HTML, Pocket, Omnivore, Linkwarden, … parsers and exporters), `logger.ts` (winston), `signedTokens.ts`, `readOnlyMode.ts`, `storageQuota.ts`, `utils/*`.

## packages/shared-server: server-only glue

- `src/queues.ts`: every queue definition (`createDeferredQueue`), request zod schemas, `triggerSearchReindex`, and `prepareQueue`/`startQueue`.
- `src/plugins.ts`: `loadAllPlugins()`. It imports the plugin packages in order, and **for the same plugin type, the last one to register wins**.
- `src/assetdb.ts` (asset read/write via the AssetStore plugin), `eventLogger.ts` + `eventLogTypes.ts` (structured event logs), `tracing.ts`, and `services/quotaService.ts`.

## packages/plugins

Each subfolder registers itself with `PluginManager` when imported, and only activates if its env vars are set. Examples: S3 if `ASSET_STORE_S3_*`, Meilisearch if `MEILI_ADDR`, Redis if `REDIS_URL`, Restate if configured. liteque stores queues in `DATA_DIR/queue.db`.

## packages/shared-react

`trpc.ts` exports `TRPCProvider`/`useTRPC` (`@trpc/tanstack-react-query`). `hooks/*` provide mutation hooks with cache invalidation (`bookmarks.ts`, `lists.ts`, `tags.ts`, `query-invalidation.ts`, …). `components/BookmarkHtmlHighlighter.tsx` is also here. Web and mobile both use this package.

## Clients

| Package | Talks via |
|---|---|
| `apps/web` UI | tRPC over `httpBatchLink` (`apps/web/lib/providers.tsx`); server components use `api` from `apps/web/server/api/client.ts` |
| `apps/mobile` | tRPC with API key (`apps/mobile/lib/providers.tsx`, `shared-react`) |
| `apps/browser-extension` | tRPC with API key (`src/utils/trpc.ts`) |
| `apps/cli` | tRPC client (`src/lib/trpc.ts`) → `/api/trpc` with Bearer key |
| `apps/mcp` | `@karakeep/sdk` REST → `/api/v1` |
| `packages/sdk` | openapi-fetch typed from `karakeep-api.d.ts` (generated from the OpenAPI spec) |

## Dependency direction

`apps/*` → `packages/{api,trpc}` → `packages/{shared-server,db}` → `packages/shared`. `packages/plugins` depends on `shared` and is only imported dynamically by `shared-server/src/plugins.ts`. Clients (cli, mobile, extension) import only **types** from `@karakeep/trpc` and runtime code from `@karakeep/shared`.
