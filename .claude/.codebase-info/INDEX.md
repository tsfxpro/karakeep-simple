# Karakeep Codebase Map

*Last Updated: 2026-09-21*

Karakeep is a self-hostable "read-it-later" bookmarking app (links, notes, images/PDFs) with AI tagging and summaries, full-text and semantic search, RSS feeds, rules, and webhooks. It is a pnpm + Turborepo TypeScript monorepo. The **Next.js web app** (`apps/web`) serves the UI and mounts the **Hono REST API + tRPC** (`packages/api`, `packages/trpc`). The **workers** process (`apps/workers`) runs background queues: crawling, inference, search indexing, and more. Data lives in **SQLite via Drizzle** (`packages/db`). Queue, search, asset-store, rate-limit, and vector-store backends are swappable **plugins** (`packages/plugins`).

Most business logic lives in `packages/trpc` (routers + models). The REST API, CLI, MCP server, mobile app, and browser extension are all clients of it.

## Documents

| Doc | What's in it |
|---|---|
| [architecture.md](architecture.md) | Components, runtime processes, request and job data flow |
| [tech-landscape.md](tech-landscape.md) | Stack, runtimes, key dependencies, source-of-truth config files |
| [directory-structure.md](directory-structure.md) | Annotated tree of apps/packages/tooling |
| [entry-points.md](entry-points.md) | Where each process starts; web routes, API mounts, CLI/MCP mains |
| [modules.md](modules.md) | Each workspace package: purpose, key files, who depends on it |
| [workers.md](workers.md) | Queues, the worker for each queue, and the post-save pipeline |
| [communication.md](communication.md) | tRPC vs REST, auth modes, OpenAPI/SDK, external integrations |
| [database.md](database.md) | Drizzle/SQLite schema, key tables, migrations, gotchas |
| [patterns.md](patterns.md) | Procedures and middleware, models, plugins, config, errors, testing |
| [coding-style.md](coding-style.md) | oxfmt/oxlint rules, import order, naming, i18n |
| [docker.md](docker.md) | Image stages, s6 services, compose files, dev containers |
| [onboarding.md](onboarding.md) | Setup, commands, and recipes for common changes |

## How to use this map

- Read this index first, then open only the docs relevant to the task.
- Verify paths before relying on them. The map is a guide, not a mirror.

## How to maintain this map

- After meaningful structural changes (new package, new queue or worker, new table, new API surface, changed tooling), update the affected doc(s) and bump its `Last Updated` line.
- Use the `codebase-mapper:update-codebase-map` skill to refresh. It re-hashes docs into `.map-state.json`.
- Keep this INDEX compact. Put detail in the atomic docs.
