# Database

*Last Updated: 2026-09-21*

**SQLite** is accessed through **better-sqlite3 + Drizzle ORM**. The DB file is `${DATA_DIR}/db.db`, or `./db.db` if `DATA_DIR` is unset (see `packages/db/drizzle.config.ts`). WAL mode is controlled by `DB_WAL_MODE`, and `DEGRADED_MODE` opens the DB read-only (`packages/db/sqlite.ts`). The liteque queue backend uses a separate `${DATA_DIR}/queue.db`.

## Files

- `packages/db/schema.ts`: every table, index, and `relations()`.
- `packages/db/drizzle.ts`: exports the `db` singleton, `DB` type, and `getInMemoryDB(runMigrations)` for tests.
- `packages/db/drizzle/`: 94 generated SQL migrations + `meta/` snapshots. **Never hand-edit them; generate new ones.**
- `packages/db/migrate.ts`: applies migrations. In Docker, the s6 service `init-db-migration` runs it before web and workers start.

## Tables (by domain)

| Domain | Tables |
|---|---|
| Auth / users | `user`, `account`, `session`, `verificationToken`, `passwordResetToken`, `apiKey`, `invites`, `subscriptions` |
| Bookmarks core | `bookmarks` (type: link/text/asset), `bookmarkLinks` (URL + crawl results), `bookmarkTexts`, `bookmarkAssets`, `assets` (files: screenshots, archives, banners, uploads) |
| Organization | `bookmarkTags`, `tagsOnBookmarks` (M:N, with `attachedBy` ai/human), `bookmarkLists` (manual + smart lists, nested), `bookmarksInLists`, `listCollaborators`, `listInvitations` |
| Reading | `highlights`, `userReadingProgress` |
| AI | `customPrompts`, `chatSessions`, `chatMessages` |
| Automation | `rssFeeds` (`rssFeedsTable`), `rssFeedImports`, `webhooks` (`webhooksTable`), `ruleEngineRules`, `ruleEngineActions` |
| Import / backup | `importSessions`, `importSessionBookmarks`, `importStagingBookmarks`, `backups` |
| Misc | `config` (key/value server config) |

Every user-owned table has `userId` → `user.id` with `onDelete: cascade`. IDs are cuid2 (`createId()`).

## Gotchas

- **`bookmarks.createdAt` maps to the `lastSavedAt` column.** Re-saving bumps it. The immutable insert time is the `dbCreatedAt` field (column `createdAt`), exposed to clients as `firstCreatedAt`. Pagination indexes are on `(userId, [archived|favourited], lastSavedAt, id)`.
- `bookmarkTags` has a virtual generated column (`mode: "virtual"`) used for normalized tag lookups.
- Enum columns are TEXT with Drizzle `enum` (e.g. `taggingStatus: pending|failure|success`, `source: api|web|extension|cli|mobile|singlefile|rss|import`).
- SQLite has a single writer. Long transactions block workers and web. Keep transactions short and synchronous (`db.transaction((tx) => …)` callbacks are sync with better-sqlite3).

## Making a schema change

1. Edit `packages/db/schema.ts`.
2. `pnpm db:generate --name description_of_change` writes a new migration in `packages/db/drizzle/`.
3. `pnpm db:migrate` applies it locally. Tests pick it up automatically through `getInMemoryDB(true)`.
4. Update zod types in `packages/shared/types/*` and the OpenAPI registry if the change is API-visible.
