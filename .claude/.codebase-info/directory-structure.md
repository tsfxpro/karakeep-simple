# Directory Structure

*Last Updated: 2026-09-21*

The project is a monorepo. `apps/*` are deployables, `packages/*` are shared libraries, `tooling/*` holds shared config, and `tools/*` holds dev utilities.

```
.
├── apps/
│   ├── web/                    Next.js app: UI + hosts the HTTP API
│   │   ├── app/                App Router pages (dashboard/, settings/, admin/, reader/, public/, signin/ …)
│   │   │   └── api/[[...route]]/route.ts   mounts @karakeep/api under /api
│   │   │   └── api/auth/[...nextauth]/     next-auth handler
│   │   ├── components/         ui/ (shadcn), dashboard/, settings/, admin/, shared/, signin/ …
│   │   ├── lib/                providers.tsx (tRPC client), i18n/ (34 locales), store/ (zustand), hooks/
│   │   └── server/             auth.ts (next-auth), api/client.ts (ctx + server caller)
│   ├── workers/                background job runner
│   │   ├── index.ts            builds + runs enabled workers
│   │   ├── workers/            one file (or folder) per queue: crawler/, inference/, adminMaintenance/ …
│   │   ├── metascraper-plugins/  custom metascraper rules (amazon, reddit, favicon)
│   │   └── server.ts           /health + /metrics
│   ├── mobile/                 Expo app (app/ = expo-router routes, components/, lib/)
│   ├── browser-extension/      MV3 extension (src/background, src/content-scripts, pages)
│   ├── cli/                    `karakeep` CLI (src/commands/*)
│   ├── mcp/                    MCP server (src/*.ts tool groups)
│   └── landing/                Astro marketing site
├── packages/
│   ├── trpc/                   routers/ (API surface), models/ (domain logic), lib/ (search, rules, rate limit, tracing)
│   ├── api/                    Hono app: routes/ (REST v1 + public/rss/assets/webhooks), middlewares/
│   ├── db/                     schema.ts, drizzle.ts (client), migrate.ts, drizzle/ (94 SQL migrations)
│   ├── shared/                 config.ts, types/ (zod schemas), inference, search parser, plugin interfaces, import-export/
│   ├── shared-server/          queues, plugin loader, asset DB helpers, event logger, tracing, quota service
│   ├── shared-react/           tRPC React context, hooks/, providers/
│   ├── plugins/                assetstore-{filesystem,s3}, queue-{liteque,restate}, search-meilisearch,
│   │                           vectorstore-meilisearch, ratelimit-{memory,redis}
│   ├── open-api/               zod-to-openapi registry → karakeep-openapi-spec.json
│   ├── sdk/                    @karakeep/sdk (openapi-fetch client over the spec)
│   ├── e2e_tests/              docker-compose-backed API/worker/web/assetdb tests
│   └── benchmarks/             perf benchmarks
├── tooling/                    oxlint/, typescript/, tailwind/, prettier/ (legacy name), github/
├── tools/
│   ├── compare-models/         compare LLM tagging outputs
│   └── seed-snapshot/          create/apply seed data snapshots (`pnpm seed:*`)
├── docker/                     Dockerfile (multi-stage), compose files, s6 service defs (root/), chrome/, garage/
├── docs/                       Docusaurus site; docs/docs = current, versioned_docs = released
├── patches/                    pnpm patchedDependencies
├── snapshots/                  seed data snapshot (tar.gz + json)
├── skills/SKILL.md             agent skill for using the Karakeep CLI
├── .github/workflows/          ci, docker, android, ios, extension, cli, mcp, sdk, chrome, pullfrog
└── .wolf/                      OpenWolf context files (not project code)
```

Organizing principle: a **monorepo with a layered backend** (router → model → db). The **web app is feature-grouped** (components grouped by page area).
