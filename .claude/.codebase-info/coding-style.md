# Coding Style

*Last Updated: 2026-09-21*

## Formatter: oxfmt (`.oxfmtrc.json`)

- Print width is 80. Prettier-compatible defaults apply (double quotes, semicolons, trailing commas).
- **Import order is enforced** in groups separated by blank lines:
  1. type imports, react / react-native, next, expo, and third-party modules
  2. `@karakeep/*` (types first)
  3. local imports: `~/`, `@/` aliases, then `../`, then `./`
- Tailwind classes are auto-sorted, including inside `cn()` and `cva()`.
- Markdown, JSON, migrations, and the OpenAPI spec are ignored.
- Commands: `pnpm format` checks and `pnpm format:fix` writes.

## Linter: oxlint (`tooling/oxlint/`)

- Plugins: typescript, import, unicorn, oxc, plus react and nextjs configs for UI packages.
- Unused vars are allowed only when prefixed with `_` (`argsIgnorePattern: "^_"`).
- `import/consistent-type-specifier-style: prefer-top-level`: write `import type { X }` rather than `import { type X }`.
- `consistent-type-imports` is off, so mixing value and type imports from one module is fine.
- Commands: `pnpm lint` and `pnpm lint:fix`. `pnpm preflight` runs typecheck + lint + format.

## Conventions observed in code

- zod schemas are prefixed `z` (`zBookmarkSchema`, `zNewBookmarkRequestSchema`), and inferred types are `Z…` (`ZBookmark`).
- tRPC routers are named `<thing>AppRouter` and files are camelCase (`publicBookmarks.ts`). Feature components in web and mobile are PascalCase files (`BookmarkCard.tsx`). The shadcn primitives in `apps/web/components/ui` are kebab-case (`action-button.tsx`).
- Path aliases: `@/` maps to the package root in web, cli, and mobile. Workspace imports use subpaths (`@karakeep/shared/types/bookmarks`).
- British spelling appears in the domain: `favourited`, `favourites`.
- Server code uses `serverConfig` and `logger`, never raw `process.env` or `console`.
- Keep DB queries scoped by `ctx.user.id`. Use ownership middlewares rather than ad-hoc checks in handlers.
- Comments are sparse and explain *why* (see the `bookmarks.createdAt` comment in `packages/db/schema.ts`).

## Commits

Commits use conventional-ish prefixes with PR number: `feat:`, `fix:`, `perf:`, `tests:`, `chore:`, `deps:`, `docs:` (e.g. `perf: use tag-first lookup for positive tag searches (#3089)`).
