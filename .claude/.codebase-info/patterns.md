# Patterns

*Last Updated: 2026-09-21*

## tRPC procedures (`packages/trpc/index.ts`)

- `procedure` is the base. It adds the read-only-mode mutation guard, Prometheus metrics, and OTel tracing.
- `publicProcedure` adds a global public rate limit (1000/min). `authedProcedure` adds a global authed rate limit (3000/min), rejects when there is no user, and enforces API-key scopes. There are also admin-only variants.
- Routers usually define a local procedure with an ownership middleware, e.g. `bookmarksProcedure.use(ensureBookmarkOwnership)`, and use `createRateLimitMiddleware({...})` for sensitive endpoints.
- Input and output are **always** zod schemas from `@karakeep/shared/types/*`, so clients share them.
- Errors: throw `TRPCError({ code, message })`. In production, the error formatter masks `INTERNAL_SERVER_ERROR` messages and attaches `zodError` on BAD_REQUEST.

## Models

- Routers stay thin. Logic lives in `packages/trpc/models/*`. The newer code uses a **repo/service split** (`*.repo.ts` for DB access, `*.service.ts` for authz and logic). Older code uses rich classes (`Bookmark.fromId(ctx, id)`, `List`, `Tag`). Follow whichever style the area already uses.
- Side effects after mutations follow a fixed trio: `triggerSearchReindex(id)`, `new WebhooksService(ctx.db).triggerWebhook(id, event, userId)`, and `RuleEngine.triggerOnEvent(...)`. Remember all three when adding a mutation that changes bookmark state.

## Plugins

- Interfaces live in `packages/shared/*` (`queueing.ts`, `search.ts`, `assetdb.ts`, `ratelimiting.ts`, `vectorStore.ts`). Implementations are in `packages/plugins/<type>-<name>`. Each registers with `PluginManager.register(...)` on import.
- `loadAllPlugins()` (`packages/shared-server/src/plugins.ts`) imports them in a fixed order. Its state is stored on `globalThis` so Next.js module duplication doesn't double-load plugins.

## Configuration

- All server env vars are parsed **once** with zod in `packages/shared/config.ts` (default export `serverConfig`). Access them as `serverConfig.crawler.numWorkers` and so on, never as raw `process.env`.
- To add an env var: add it to the zod schema, map it into the structured config object, and document it in `docs/docs/03-configuration/`.
- Adding a client config group means updating `clientConfig` in `config.ts`, `zClientConfigSchema` (`packages/shared/types/config.ts`), and the defaults and merge in `ClientConfigProvider`. The defaults keep older servers' behavior (e.g. `archiving.actionsEnabled: true`).
- Heavy optional SDKs (openai/ollama in `shared/inference.ts`, stripe in `routers/subscriptions.ts`, nodemailer in `trpc/email.ts`) are imported lazily on first use to keep idle memory low. Keep new optional integrations lazy too.
- Client-safe settings are exposed through `routers/config.ts`, `ClientConfigProvider` (`packages/shared-react/providers/client-config-provider.tsx`), and `apps/web/lib/clientConfig.tsx`.

## Frontend (web)

- Data access goes through `useTRPC()` + TanStack Query. Shared mutation hooks in `packages/shared-react/hooks/*` handle cache invalidation. Server components use `api` from `apps/web/server/api/client.ts`.
- Local UI state lives in zustand stores (`apps/web/lib/store/*`). Per-user local settings are in `apps/web/lib/userLocalSettings/`.
- UI primitives are shadcn in `apps/web/components/ui`. Class names are merged with the `cn()` helper.
- All UI text goes through i18n (`apps/web/lib/i18n/`, `useTranslation`). Keys live in `lib/i18n/locales/<lang>/translation.json`. Add new keys to `en` (the other locales are community-translated).

## Observability

- Logging: `@karakeep/shared/logger` (winston). Don't use `console.log` in server code.
- Structured events: `logEvent` / `addLogFields` (`shared-server/src/eventLogger.ts`, types in `eventLogTypes.ts`). Workers wrap runs with `withWorkerEventLog` (`apps/workers/workerTracing.ts`).
- Tracing: `withSpan` / `withSpanSync` in `shared-server/src/tracing.ts` and `packages/trpc/lib/tracing.ts`.

## Testing

- **Unit (Vitest)** sits next to the code as `*.test.ts`. tRPC router tests use `packages/trpc/testUtils.ts`, which provides an in-memory migrated SQLite DB, seeded users, a `createCallerFactory` caller, and hoisted queue mocks (`getTestQueueMocks()`).
- **E2E** tests are in `packages/e2e_tests`. `setup/startContainers.ts` brings up docker-compose (web, workers, nginx fixtures, an AI mock in `setup/aimock`). Tests are under `tests/{api,workers,web,assetdb}`. They are slow, so use `E2E_TEST_NO_BUILD=1` (`test:no-build`) to reuse images.
- Run everything with `pnpm test`, or a single package with `pnpm --filter @karakeep/trpc test`.
