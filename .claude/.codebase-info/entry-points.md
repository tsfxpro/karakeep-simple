# Entry Points

*Last Updated: 2026-09-21*

## Processes

| Process | Entry | Start (dev) |
|---|---|---|
| Web + API | `apps/web` (Next.js); root layout `apps/web/app/layout.tsx`; instrumentation `apps/web/instrumentation.ts` | `pnpm web` |
| Workers | `apps/workers/index.ts` (`main()`) | `pnpm workers` |
| DB migrations | `packages/db/migrate.ts` | `pnpm db:migrate` |
| CLI | `apps/cli/src/index.ts` | `pnpm --filter @karakeep/cli run run -- <args>` |
| MCP server | `apps/mcp/src/index.ts` (env: `KARAKEEP_API_ADDR`, `KARAKEEP_API_KEY`) | `pnpm --filter @karakeep/mcp run run` |
| Mobile | `apps/mobile/app/_layout.tsx` (expo-router) | `pnpm ios` / `pnpm android` |
| Extension | `apps/browser-extension/src/main.tsx` (popup), `src/background/background.ts`, `manifest.json` | `pnpm --filter @karakeep/browser-extension dev` |
| OpenAPI gen | `packages/open-api/index.ts` | `pnpm --filter @karakeep/open-api generate` |
| Landing | `apps/landing` (Astro) | `pnpm --filter @karakeep/landing dev` |

## HTTP surface (all under the web app's `/api`)

`apps/web/app/api/[[...route]]/route.ts` builds the tRPC `Context` from the request (API key or session) and mounts `packages/api/index.ts`:

| Mount | File | Notes |
|---|---|---|
| `/api/trpc/*` | `packages/api/routes/trpc.ts` | Full tRPC `appRouter` (`packages/trpc/routers/_app.ts`) |
| `/api/v1/bookmarks, lists, tags, highlights, users, assets, admin, rss, backups, feeds` | `packages/api/routes/*.ts` | REST, documented by OpenAPI; each handler calls `c.var.api.<router>.<proc>` |
| `/api/assets/*` | `packages/api/routes/assets.ts` | Asset upload/download |
| `/api/public/*` | `packages/api/routes/public.ts` | Public list assets |
| `/api/webhooks/*` | `packages/api/routes/webhooks.ts` | Inbound webhooks (e.g. Stripe) |
| `/api/health`, `/api/version`, `/api/metrics` | `routes/health.ts`, `version.ts`, `metrics.ts` | Metrics require `PROMETHEUS_AUTH_TOKEN` |
| `/api/auth/*` | `apps/web/app/api/auth/[...nextauth]/` | next-auth |
| `/api/bookmarks/export` | `apps/web/app/api/bookmarks/export/` | Export download |

## tRPC routers (`packages/trpc/routers/`)

`bookmarks`, `apiKeys`, `users`, `lists`, `tags`, `prompts`, `admin`, `feeds`, `backups`, `highlights`, `importSessions`, `webhooks`, `assets`, `rules`, `invites`, `publicBookmarks`, `subscriptions`, `config`. Most have a `*.test.ts` next to them.

## Web pages (`apps/web/app/`)

- `dashboard/`: bookmarks, archive, favourites, lists/[listId], tags/[tagId], feeds/[feedId], highlights, search, cleanups, preview/[bookmarkId] (also an intercepting modal in `@modal/(.)preview`).
- `settings/`: ai, api-keys, assets, backups, broken-links, feeds, import(/[sessionId]), info, rules, stats, subscription, webhooks.
- `admin/`: overview, users, background_jobs, admin_tools.
- `reader/[bookmarkId]`, `public/lists/[listId]`, and the auth pages (signin, signup, forgot/reset-password, verify-email, invite/[token]).

## Background entry points

The workers in `apps/workers/index.ts` → `workerBuilders` are toggled with `WORKERS_ENABLED_WORKERS` / `WORKERS_DISABLED_WORKERS`. `FeedRefreshingWorker` and `BackupSchedulingWorker` are cron-like schedulers. `ImportWorker` is a polling loop. See [workers.md](workers.md).

Ad-hoc scripts: `apps/workers/scripts/crawlAdhoc.ts`, `tools/seed-snapshot/src/{index,apply}.ts`.
