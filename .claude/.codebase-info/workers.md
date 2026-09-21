# Workers and Queues

*Last Updated: 2026-09-21*

Every queue is defined in `packages/shared-server/src/queues.ts`, together with its payload zod schema and options (retries, timeouts, concurrency from config). Queues are **deferred**: nothing connects until the first `enqueue` or `ensureInit`, which loads plugins and gets the queue client from the Queue plugin. The default backend is liteque (`DATA_DIR/queue.db`).

## Queue → worker table

| Queue const | Queue name | Worker (apps/workers/workers/) | Does |
|---|---|---|---|
| `LinkCrawlerQueue` | `link_crawler_queue` | `crawlerWorker.ts` + `crawler/*` | Fetch the page (Playwright/Chrome or plain fetch), metascraper metadata, Readability content, screenshot/PDF/monolith archive, banner image |
| `LowPriorityCrawlerQueue` | `low_priority_crawler_queue` | same `CrawlerWorker` | Imports and recrawls |
| `OpenAIQueue` | `openai_queue` | `inference/inferenceWorker.ts` (`tagging.ts`, `summarize.ts`) | AI tags / summary |
| `EmbeddingsQueue` | `embeddings_queue` | `embeddingsWorker.ts` | Vector embeddings → VectorStore plugin |
| `SearchIndexingQueue` | `searching_indexing` | `searchWorker.ts` | Index/delete in the Search plugin |
| `AssetPreprocessingQueue` | `asset_preprocessing_queue` | `assetPreprocessingWorker.ts` | OCR images, extract PDF text, thumbnails |
| `VideoWorkerQueue` | `video_queue` | `videoWorker.ts` | yt-dlp video download |
| `FeedQueue` | `feed_queue` | `feedWorker.ts` (+ `FeedRefreshingWorker` cron) | Poll RSS feeds → create bookmarks |
| `WebhookQueue` | `webhook_queue` | `webhookWorker.ts` | Deliver user webhooks |
| `RuleEngineQueue` | `rule_engine_queue` | `ruleEngineWorker.ts` | Evaluate user rules on events |
| `BackupQueue` | `backup_queue` | `backupWorker.ts` (+ `BackupSchedulingWorker`) | Scheduled user exports |
| `AdminMaintenanceQueue` | `admin_maintenance_queue` | `adminMaintenanceWorker.ts` (`adminMaintenance/tasks/*`) | tidyAssets, migrateLinkHtmlContent |
| (none, polling) | — | `importWorker.ts` | Drains `importStagingBookmarks` for import sessions |

Worker names for `WORKERS_ENABLED_WORKERS` / `WORKERS_DISABLED_WORKERS`: `crawler, lowPriorityCrawler, embeddings, inference, search, adminMaintenance, video, feed, assetPreprocessing, webhook, ruleEngine, backup, import`.

## Fan-out after save

```
createBookmark ─┬─ link  → LinkCrawlerQueue ─► crawler ─┬─ OpenAIQueue (tag+summarize) ─► RuleEngine event, webhook, reindex
                │                                       ├─ EmbeddingsQueue
                │                                       ├─ VideoWorkerQueue
                │                                       ├─ AssetPreprocessingQueue (downloaded PDFs/images)
                │                                       ├─ triggerSearchReindex
                │                                       └─ webhook "crawled"
                ├─ text  → OpenAIQueue + EmbeddingsQueue
                ├─ asset → AssetPreprocessingQueue ─► OpenAIQueue, EmbeddingsQueue, reindex
                └─ always: RuleEngine(bookmarkAdded), triggerSearchReindex, webhook "created"
```

## Conventions

- Each worker exposes a `static build()` that creates a runner on its queue. The run function is wrapped with `withWorkerEventLog(...)` and tracing (`apps/workers/workerTracing.ts`, `workerUtils.ts`).
- Workers act on behalf of a user through `buildImpersonatingTRPCClient(userId)` (`apps/workers/trpc.ts`) when they need tRPC logic.
- Status columns on `bookmarks` (`taggingStatus`, `summarizationStatus`, `embeddingStatus`) and on `bookmarkLinks` (crawl status) track progress. The admin "background jobs" page reads queue `stats()`.
- HTML parsing runs in a **subprocess** with memory and time limits (`crawler/parseSubprocess.ts`, `scripts/parseHtmlSubprocess.ts`, `utils/parseHtmlSubprocessIpc.ts`), controlled by `CRAWLER_PARSER_MEM_LIMIT_MB` and `CRAWLER_PARSE_TIMEOUT_SEC`.
- Outbound fetches use SSRF-safe network helpers (`apps/workers/network.ts`, `CRAWLER_ALLOWED_INTERNAL_HOSTNAMES`) plus per-domain rate limits.
- Adding a queue: define it in `queues.ts`, write `apps/workers/workers/<x>Worker.ts` with `build()`, register it in `workerBuilders` in `apps/workers/index.ts`, and add `*_NUM_WORKERS` / timeout config in `packages/shared/config.ts` if needed.
