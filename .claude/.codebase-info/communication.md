# Communication

*Last Updated: 2026-09-21*

## Two API faces, one implementation

- **tRPC** (`/api/trpc`): the primary, full-featured API. It uses the superjson transformer and batching. The web UI, mobile app, extension, and CLI use it. The max URL length constants are in `packages/shared/trpc.ts`.
- **REST v1** (`/api/v1`): a stable public API. It is a thin Hono layer: each route validates with zod, then calls the **tRPC server-side caller** (`c.var.api.bookmarks.getBookmarks(...)`) set up by `packages/api/middlewares/auth.ts`. TRPCErrors are converted to HTTP errors by `middlewares/trpcAdapter.ts`.
- **OpenAPI**: `packages/open-api/lib/*.ts` registers REST routes with zod-to-openapi. `pnpm --filter @karakeep/open-api generate` writes `karakeep-openapi-spec.json`, and `check` verifies it is up to date. **Changing a REST route means updating the matching registry file and regenerating.** `packages/sdk` types are generated from this spec.

## Authentication

| Mode | How | Resolved in |
|---|---|---|
| Session (web UI) | next-auth JWT cookie; credentials provider + optional OIDC (`OAUTH_*`) | `apps/web/server/auth.ts` |
| API key | `Authorization: Bearer <key>`; keys have **scopes** (`packages/shared/types/apiKeys.ts`) | `authenticateApiKey` in `packages/trpc/auth.ts`, used by `apps/web/server/api/client.ts` |
| Worker impersonation | in-process context for a userId | `packages/trpc/lib/impersonate.ts` |

Scope enforcement happens in tRPC procedures (`packages/trpc/index.ts`) and in Hono (`middlewares/apiKeyScopes.ts`). Rate limiting is applied through the RateLimit plugin in both layers. Signup captcha uses Cloudflare Turnstile (`lib/turnstile.ts`).

## Internal async messaging

This is queue-based only. See [workers.md](workers.md). There is no pub/sub between web and workers other than queues and the shared DB.

## External integrations

| Service | Purpose | Config / code |
|---|---|---|
| OpenAI-compatible APIs / Ollama | tagging, summaries, OCR-by-LLM, chat, embeddings | `OPENAI_*`, `OLLAMA_*`, `INFERENCE_*`, `EMBEDDING_*`; `packages/shared/inference.ts` |
| Headless Chrome | crawling | `BROWSER_WEB_URL` / `BROWSER_WEBSOCKET_URL`; `apps/workers/workers/crawler/browser.ts`; image built from `docker/chrome` |
| Meilisearch | full-text + vector search | `MEILI_*`; `packages/plugins/search-meilisearch`, `vectorstore-meilisearch` |
| S3-compatible storage | assets | `packages/plugins/assetstore-s3` (Garage config for dev in `docker/garage`) |
| Redis | distributed rate limiting | `REDIS_URL`; `packages/plugins/ratelimit-redis` |
| Restate | alternative durable queue | `packages/plugins/queue-restate` |
| SMTP | verification / password reset / invites | `SMTP_*`; `packages/trpc/email.ts` |
| Stripe | subscriptions, quotas | `STRIPE_*`; `routers/subscriptions.ts`, `packages/api/routes/webhooks.ts` |
| OTLP collector | traces + event logs | `OTEL_*`; `packages/shared-server/src/tracing.ts`, `eventLogger.ts` |
| Prometheus | metrics scrape | `/api/metrics`, workers `/metrics`, `PROMETHEUS_AUTH_TOKEN` |
| User webhooks | outbound events (created, crawled, edited, …) | `models/webhooks.service.ts` → `WebhookQueue` |
| RSS | inbound feeds + outbound list feeds | `feedWorker.ts`; `packages/api/routes/rss.ts` |
