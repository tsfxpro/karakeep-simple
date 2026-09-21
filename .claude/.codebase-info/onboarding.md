# Onboarding

*Last Updated: 2026-09-21*

## Quick start

```bash
pnpm install
cp .env.sample .env          # set DATA_DIR and NEXTAUTH_SECRET at minimum
pnpm db:migrate
pnpm web                     # http://localhost:3000 (does not return)
pnpm workers                 # separate terminal (does not return)
# or: ./start-dev.sh  (starts meilisearch + chrome containers, then web + workers)
```

Optional services: Meilisearch (`MEILI_ADDR`) for search, Chrome (`BROWSER_WEB_URL`) for full crawling, and `OPENAI_API_KEY` or `OLLAMA_BASE_URL` for AI. Seed data: `pnpm seed:apply`.

## Commands

| Command | Does |
|---|---|
| `pnpm typecheck` / `lint` / `format` / `test` | Workspace-wide checks (turbo) |
| `pnpm preflight` / `preflight:fix` | typecheck + lint + format together |
| `pnpm --filter @karakeep/<pkg> test` | Tests for one package |
| `pnpm db:generate --name <desc>` | New migration after schema change |
| `pnpm db:migrate` / `db:studio` | Apply migrations / Drizzle Studio |
| `pnpm --filter @karakeep/open-api generate` | Regenerate the OpenAPI spec |
| `pnpm --filter @karakeep/e2e_tests test` | E2E (Docker required) |

## Common tasks

**Add a tRPC endpoint:** add a zod schema in `packages/shared/types/<area>.ts` → add the procedure in `packages/trpc/routers/<area>.ts` (choose `authedProcedure` or an ownership-scoped one) → put logic in `models/<area>*` → add a test in `routers/<area>.test.ts` using `testUtils.ts` → consume it through `useTRPC()` or a hook in `packages/shared-react/hooks/`.

**Expose it via REST:** add a Hono route in `packages/api/routes/<area>.ts` that calls `c.var.api.<router>.<proc>` → register it in `packages/open-api/lib/<area>.ts` → regenerate the spec. Optionally rebuild the SDK.

**Schema change:** see [database.md](database.md#making-a-schema-change).

**New background job:** see [workers.md](workers.md#conventions).

**New env var:** see `packages/shared/config.ts` and document it in `docs/docs/03-configuration/`.

**New UI page (web):** add a route under `apps/web/app/...` and components under `apps/web/components/<area>/`. Use shadcn primitives from `components/ui`, and put new strings in `apps/web/lib/i18n/locales/en/translation.json`.

**New backend plugin:** implement the interface from `packages/shared/<type>.ts` in `packages/plugins/<type>-<name>/`, register it with `PluginManager`, and add its import to `loadAllPlugins()` (order matters; the last one registered wins).

## Gotchas

- `bookmarks.createdAt` is really `lastSavedAt` (see [database.md](database.md)).
- React versions are pinned workspace-wide for React Native. Don't bump them in one app alone.
- Mutations are globally blocked in demo, read-only, and degraded modes. If writes fail in dev, check `DEMO_MODE` and `DEGRADED_MODE`.
- The shadcn components are in `apps/web/components/ui` (not `packages/web/...` as `CLAUDE.md` says).
- This repo also has OpenWolf state in `.wolf/`. That is agent tooling, not app code.
