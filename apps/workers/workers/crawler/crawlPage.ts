// The browser-based page fetch: navigates to the URL in a Playwright context
// (with redirect/sub-request SSRF guards, adblocking, and proxy auth) and
// captures the page's HTML, an optional screenshot, and an optional PDF.
// Falls back to a plain HTTP fetch when no browser is available or the user
// has browser crawling disabled.
import { eq } from "drizzle-orm";
import {
  fetchWithProxy,
  getBookmarkDomain,
  matchesNoProxy,
  validateUrl,
} from "network";
import type { RunProxyConfig } from "network";
import {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  CDPSession,
  Page,
} from "playwright";
import { abortRace, abortRaceResolve, raceWith, timeoutRace } from "utils";

import { db } from "@karakeep/db";
import { users } from "@karakeep/db/schema";
import {
  getTracer,
  setSpanAttributes,
  withSpan,
} from "@karakeep/shared-server";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";
import { tryCatch } from "@karakeep/shared/tryCatch";

import type { AutoconsentHandle } from "./autoconsent";
import {
  installAutoconsent,
  waitForPageLoadAndAutoconsent,
} from "./autoconsent";
import {
  CONTEXT_CLOSE_TIMEOUT_MS,
  PAGE_CLOSE_TIMEOUT_MS,
  acquireBrowserSession,
  getGlobalBlocker,
  getGlobalBrowser,
  getGlobalCookies,
  getPlaywrightProxyConfig,
  startBrowserInstance,
  trackContext,
  untrackContext,
} from "./browser";
import { SessionBudget } from "./browserSession";
import { truncateUrl } from "./utils";

const tracer = getTracer("@karakeep/workers");

export interface CrawlPageResult {
  htmlContent: string;
  screenshot: Buffer | undefined;
  pdf: Buffer | undefined;
  statusCode: number;
  url: string;
}

function getHeaderValue(
  headers: { name: string; value: string }[] | undefined,
  name: string,
): string | undefined {
  return headers?.find((header) => header.name.toLowerCase() === name)?.value;
}

async function browserlessCrawlPage(
  jobId: string,
  url: string,
  abortSignal: AbortSignal,
  runProxy: RunProxyConfig,
): Promise<CrawlPageResult> {
  return await withSpan(
    tracer,
    "crawlerWorker.browserlessCrawlPage",
    {
      attributes: {
        "bookmark.url": url,
        "bookmark.domain": getBookmarkDomain(url),
        "job.id": jobId,
      },
    },
    async () => {
      logger.info(
        `[Crawler][${jobId}] Running in browserless mode. Will do a plain http request to "${truncateUrl(url)}". Screenshots will be disabled.`,
      );
      const response = await fetchWithProxy(
        url,
        {
          signal: AbortSignal.any([AbortSignal.timeout(5000), abortSignal]),
        },
        runProxy,
      );
      logger.info(
        `[Crawler][${jobId}] Successfully fetched the content of "${truncateUrl(url)}". Status: ${response.status}, Size: ${response.size}`,
      );
      return {
        htmlContent: await response.text(),
        statusCode: response.status,
        screenshot: undefined,
        pdf: undefined,
        url: response.url,
      };
    },
  );
}

/**
 * Installs a CDP-level guard that validates every redirect target before the
 * browser follows it (blocking redirects into disallowed/internal addresses)
 * and answers proxy auth challenges with the run's proxy credentials.
 */
async function installRedirectGuard(
  context: BrowserContext,
  page: Page,
  jobId: string,
  proxyConfig: BrowserContextOptions["proxy"],
): Promise<CDPSession | undefined> {
  let cdpSession: CDPSession | undefined;

  try {
    cdpSession = await context.newCDPSession(page);
    const continuePausedRequest = async (requestId: string) => {
      await cdpSession
        ?.send("Fetch.continueRequest", { requestId })
        .catch(() => {
          // Ignore errors — the request may have been canceled.
        });
    };
    const failPausedRequest = async (requestId: string) => {
      await cdpSession
        ?.send("Fetch.failRequest", {
          requestId,
          errorReason: "BlockedByClient",
        })
        .catch(() => {
          // Ignore errors — the request may have been canceled.
        });
    };
    cdpSession.on("Fetch.authRequired", async (event) => {
      const authChallengeResponse =
        event.authChallenge.source === "Proxy" &&
        (proxyConfig?.username || proxyConfig?.password)
          ? {
              response: "ProvideCredentials" as const,
              username: proxyConfig.username ?? "",
              password: proxyConfig.password ?? "",
            }
          : { response: "Default" as const };
      await cdpSession
        ?.send("Fetch.continueWithAuth", {
          requestId: event.requestId,
          authChallengeResponse,
        })
        .catch(() => {
          // Ignore errors — the request may have been canceled.
        });
    });
    cdpSession.on("Fetch.requestPaused", async (event) => {
      try {
        const status = event.responseStatusCode;
        if (!status || status < 300 || status >= 400) {
          await continuePausedRequest(event.requestId);
          return;
        }

        const location = getHeaderValue(event.responseHeaders, "location");
        if (!location) {
          await continuePausedRequest(event.requestId);
          return;
        }

        const redirectUrl = new URL(location, event.request.url).toString();
        const redirectIsRunningInProxyContext =
          proxyConfig !== undefined &&
          !matchesNoProxy(redirectUrl, proxyConfig.bypass?.split(",") ?? []);
        const validation = await validateUrl(
          redirectUrl,
          redirectIsRunningInProxyContext,
        );

        if (validation.ok) {
          await continuePausedRequest(event.requestId);
          return;
        }

        logger.warn(
          `[Crawler][${jobId}] Blocking redirect to disallowed URL "${redirectUrl}": ${validation.reason}`,
        );
        await failPausedRequest(event.requestId);
      } catch (e) {
        logger.warn(
          `[Crawler][${jobId}] Blocking redirect after redirect guard failed: ${e}`,
        );
        await failPausedRequest(event.requestId);
      }
    });
    // Pausing at the request stage is only needed to answer proxy auth
    // challenges. Skipping it otherwise saves a CDP round-trip per request,
    // which adds up quickly with a remote browser.
    const needsProxyAuth = !!(proxyConfig?.username || proxyConfig?.password);
    await cdpSession.send("Fetch.enable", {
      handleAuthRequests: needsProxyAuth,
      patterns: needsProxyAuth
        ? [
            { urlPattern: "*", requestStage: "Request" },
            { urlPattern: "*", requestStage: "Response" },
          ]
        : [{ urlPattern: "*", requestStage: "Response" }],
    });
  } catch (e) {
    logger.warn(`[Crawler][${jobId}] Failed to install redirect guard: ${e}`);
  }

  return cdpSession;
}

/**
 * Creates and configures the page: redirect guard, adblocking, dialog
 * auto-dismissal, media/SSRF request blocking, and abort wiring.
 */
interface SetupPageResult {
  page: Page;
  autoconsent: AutoconsentHandle | undefined;
}

async function setupPage(
  context: BrowserContext,
  jobId: string,
  proxyConfig: BrowserContextOptions["proxy"],
  abortSignal: AbortSignal,
): Promise<SetupPageResult> {
  return await withSpan(
    tracer,
    "crawlerWorker.crawlPage.setupPage",
    {
      attributes: {
        "job.id": jobId,
      },
    },
    async () => {
      // Create a new page in the context
      const nextPage = await context.newPage();
      const cdpSession = await installRedirectGuard(
        context,
        nextPage,
        jobId,
        proxyConfig,
      );

      // Apply ad blocking
      const globalBlocker = getGlobalBlocker();
      if (globalBlocker) {
        await globalBlocker.enableBlockingInPage(nextPage);
      }

      // Auto-dismiss JavaScript dialogs (alert, confirm, prompt)
      // to prevent pages from hanging during crawl.
      nextPage.on("dialog", (dialog) => {
        dialog.dismiss().catch(() => {
          // Ignore errors — the dialog may have already been closed.
        });
      });

      // Block audio/video resources and disallowed sub-requests
      await nextPage.route("**/*", async (route) => {
        if (abortSignal.aborted) {
          await route.abort("aborted");
          return;
        }
        const request = route.request();
        const resourceType = request.resourceType();

        // Block audio/video resources
        if (
          resourceType === "media" ||
          request.headers()["content-type"]?.includes("video/") ||
          request.headers()["content-type"]?.includes("audio/")
        ) {
          await route.abort("aborted");
          return;
        }

        const requestUrl = request.url();
        const requestIsRunningInProxyContext =
          proxyConfig !== undefined &&
          !matchesNoProxy(requestUrl, proxyConfig.bypass?.split(",") ?? []);
        if (
          requestUrl.startsWith("http://") ||
          requestUrl.startsWith("https://")
        ) {
          const validation = await validateUrl(
            requestUrl,
            requestIsRunningInProxyContext,
          );
          if (!validation.ok) {
            logger.warn(
              `[Crawler][${jobId}] Blocking sub-request to disallowed URL "${requestUrl}": ${validation.reason}`,
            );
            await route.abort("blockedbyclient");
            return;
          }
        }

        // Continue with other requests
        await route.fallback();
      });

      // Install autoconsent AFTER the redirect guard and SSRF request router
      // are in place (conservative ordering; it injects scripts). No-op unless
      // enabled and the bundle loaded.
      const autoconsent = await installAutoconsent(nextPage, jobId);

      // On abort, immediately stop intercepting requests so that
      // in-flight route handlers don't block page/context closure.
      abortSignal.addEventListener(
        "abort",
        () => {
          cdpSession?.detach().catch(() => {
            // Ignore errors — the session may already be detached.
          });
          nextPage.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {
            // Ignore errors — the page may already be closed.
          });
        },
        { once: true },
      );

      return { page: nextPage, autoconsent };
    },
  );
}

/**
 * Extracts the page HTML and (depending on config) captures a screenshot and
 * a PDF, all in parallel.
 */
async function capturePageAssets(
  activePage: Page,
  jobId: string,
  forceStorePdf: boolean,
  abortSignal: AbortSignal,
  budget: SessionBudget,
): Promise<[string, Buffer | undefined, Buffer | undefined]> {
  // Screenshots and PDFs are optional: skip them when they would push the
  // session past its budget.
  const assetTimeoutMs = serverConfig.crawler.screenshotTimeoutSec * 1000;
  const assetsFitBudget = budget.fits(assetTimeoutMs);
  if (!assetsFitBudget) {
    logger.info(
      `[Crawler][${jobId}] Skipping screenshot/PDF capture, not enough session budget left.`,
    );
  }
  return await withSpan(
    tracer,
    "crawlerWorker.crawlPage.captureAssets",
    {
      attributes: {
        "job.id": jobId,
      },
    },
    async () => {
      const htmlPromise = withSpan(
        tracer,
        "crawlerWorker.crawlPage.extractHtml",
        {
          attributes: {
            "job.id": jobId,
          },
        },
        async () => {
          const content = await activePage.content();
          abortSignal.throwIfAborted();
          logger.info(
            `[Crawler][${jobId}] Successfully fetched the page content.`,
          );
          return content;
        },
      );

      const screenshotPromise: Promise<Buffer | undefined> =
        serverConfig.crawler.storeScreenshot && assetsFitBudget
          ? withSpan(
              tracer,
              "crawlerWorker.crawlPage.captureScreenshot",
              {
                attributes: {
                  "job.id": jobId,
                  "asset.type": "image",
                },
              },
              async () => {
                const { data: screenshotData, error: screenshotError } =
                  await tryCatch(
                    raceWith<Buffer>(
                      activePage.screenshot({
                        // If you change this, you need to change the asset type in the store function.
                        type: "jpeg",
                        fullPage: serverConfig.crawler.fullPageScreenshot,
                        quality: 80,
                      }),
                      timeoutRace<Buffer>(
                        serverConfig.crawler.screenshotTimeoutSec * 1000,
                        () => {
                          throw new Error(
                            "TIMED_OUT, consider increasing CRAWLER_SCREENSHOT_TIMEOUT_SEC",
                          );
                        },
                      ),
                      abortRaceResolve(abortSignal, Buffer.from("")),
                    ),
                  );
                abortSignal.throwIfAborted();
                if (screenshotError) {
                  logger.warn(
                    `[Crawler][${jobId}] Failed to capture the screenshot. Reason: ${screenshotError}`,
                  );
                  return undefined;
                }
                setSpanAttributes({
                  "asset.size": screenshotData.byteLength,
                });
                logger.info(
                  `[Crawler][${jobId}] Finished capturing page content and a screenshot. FullPageScreenshot: ${serverConfig.crawler.fullPageScreenshot}`,
                );
                return screenshotData;
              },
            )
          : Promise.resolve(undefined);

      const pdfPromise: Promise<Buffer | undefined> =
        (serverConfig.crawler.storePdf || forceStorePdf) && assetsFitBudget
          ? withSpan(
              tracer,
              "crawlerWorker.crawlPage.capturePdf",
              {
                attributes: {
                  "job.id": jobId,
                  "asset.type": "pdf",
                },
              },
              async () => {
                const { data: pdfData, error: pdfError } = await tryCatch(
                  raceWith<Buffer>(
                    activePage.pdf({
                      format: "A4",
                      printBackground: true,
                    }),
                    timeoutRace<Buffer>(
                      serverConfig.crawler.screenshotTimeoutSec * 1000,
                      () => {
                        throw new Error(
                          "TIMED_OUT, consider increasing CRAWLER_SCREENSHOT_TIMEOUT_SEC",
                        );
                      },
                    ),
                    abortRaceResolve(abortSignal, Buffer.from("")),
                  ),
                );
                abortSignal.throwIfAborted();
                if (pdfError) {
                  logger.warn(
                    `[Crawler][${jobId}] Failed to capture the PDF. Reason: ${pdfError}`,
                  );
                  return undefined;
                }
                setSpanAttributes({
                  "asset.size": pdfData.byteLength,
                });
                logger.info(
                  `[Crawler][${jobId}] Finished capturing page content as PDF`,
                );
                return pdfData;
              },
            )
          : Promise.resolve(undefined);

      const captureResults = await Promise.all([
        htmlPromise,
        screenshotPromise,
        pdfPromise,
      ] as const);
      abortSignal.throwIfAborted();
      return captureResults;
    },
  );
}

/**
 * Closes the page and its context with timeouts so a hung close can't wedge
 * the job; contexts that fail to close stay tracked for the reaper. Also
 * closes the browser itself when it was connected on demand.
 */
async function closePageAndContext(
  page: Page | undefined,
  context: BrowserContext,
  browser: Browser,
  jobId: string,
): Promise<void> {
  await withSpan(
    tracer,
    "crawlerWorker.crawlPage.cleanup",
    {
      attributes: {
        "job.id": jobId,
        "crawler.cleanup.hasPage": !!page,
      },
    },
    async () => {
      // Explicitly close the page first (with timeout) to release resources
      // even if context.close() later hangs.
      if (page) {
        const pageToClose = page;
        const pageClosed = await withSpan(
          tracer,
          "crawlerWorker.crawlPage.cleanup.closePage",
          { attributes: { "job.id": jobId } },
          async () =>
            raceWith<boolean>(
              pageToClose
                .close()
                .then(() => true)
                .catch((e: unknown) => {
                  logger.warn(`[Crawler][${jobId}] page.close() failed: ${e}`);
                  return true;
                }),
              timeoutRace<boolean>(PAGE_CLOSE_TIMEOUT_MS, () => false),
            ),
        );
        setSpanAttributes({ "crawler.cleanup.pageClosed": pageClosed });
        if (!pageClosed) {
          logger.warn(`[Crawler][${jobId}] page.close() timed out`);
        }
      }

      // Close the context (with timeout) to avoid hanging on in-flight ops.
      // Only remove from tracking if close actually succeeded; otherwise
      // the reaper will retry the close later.
      const contextClosed = await withSpan(
        tracer,
        "crawlerWorker.crawlPage.cleanup.closeContext",
        { attributes: { "job.id": jobId } },
        async () =>
          raceWith<boolean>(
            context
              .close()
              .then(() => true)
              .catch((e: unknown) => {
                logger.warn(`[Crawler][${jobId}] context.close() failed: ${e}`);
                return true; // Error means it's likely already closed
              }),
            timeoutRace<boolean>(CONTEXT_CLOSE_TIMEOUT_MS, () => false),
          ),
      );
      setSpanAttributes({
        "crawler.cleanup.contextClosed": contextClosed,
      });

      if (contextClosed) {
        untrackContext(jobId);
      } else {
        logger.warn(
          `[Crawler][${jobId}] context.close() timed out — leaving in active set for reaper`,
        );
      }

      // Only close the browser if it was created on demand
      if (serverConfig.crawler.browserConnectOnDemand) {
        await withSpan(
          tracer,
          "crawlerWorker.crawlPage.cleanup.closeBrowser",
          { attributes: { "job.id": jobId } },
          async () => {
            const browserClosed = await raceWith<boolean>(
              browser
                .close()
                .then(() => {
                  untrackContext(jobId);
                  return true;
                })
                .catch((e: unknown) => {
                  logger.warn(
                    `[Crawler][${jobId}] browser.close() failed: ${e}`,
                  );
                  return true;
                }),
              timeoutRace<boolean>(CONTEXT_CLOSE_TIMEOUT_MS, () => false),
            );
            if (!browserClosed) {
              logger.warn(`[Crawler][${jobId}] browser.close() timed out`);
            }
          },
        );
      }
    },
  );
}

export async function crawlPage(
  jobId: string,
  url: string,
  userId: string,
  forceStorePdf: boolean,
  abortSignal: AbortSignal,
  runProxy: RunProxyConfig,
  // When set, skips the per-user browserCrawlingEnabled DB lookup and uses this
  // value instead. Used by the adhoc crawl CLI, which has no user row.
  browserCrawlingEnabledOverride?: boolean,
): Promise<CrawlPageResult> {
  return await withSpan(
    tracer,
    "crawlerWorker.crawlPage",
    {
      attributes: {
        "bookmark.url": url,
        "bookmark.domain": getBookmarkDomain(url),
        "job.id": jobId,
        "user.id": userId,
        "crawler.forceStorePdf": forceStorePdf,
      },
    },
    async () => {
      let browserCrawlingEnabled: boolean | null;
      if (browserCrawlingEnabledOverride !== undefined) {
        browserCrawlingEnabled = browserCrawlingEnabledOverride;
      } else {
        const userData = await db.query.users.findFirst({
          where: eq(users.id, userId),
          columns: { browserCrawlingEnabled: true },
        });
        if (!userData) {
          logger.error(`[Crawler][${jobId}] User ${userId} not found`);
          throw new Error(`User ${userId} not found`);
        }
        browserCrawlingEnabled = userData.browserCrawlingEnabled;
      }

      if (browserCrawlingEnabled !== null && !browserCrawlingEnabled) {
        return browserlessCrawlPage(jobId, url, abortSignal, runProxy);
      }

      const releaseSession = await acquireBrowserSession(abortSignal);
      try {
        return await crawlPageInBrowser(
          jobId,
          url,
          forceStorePdf,
          abortSignal,
          runProxy,
        );
      } finally {
        releaseSession();
      }
    },
  );
}

/**
 * Crawls the page with a browser session: connects (or reuses the shared
 * connection), and fits navigation, waits and captures into the session
 * budget when one is configured.
 */
async function crawlPageInBrowser(
  jobId: string,
  url: string,
  forceStorePdf: boolean,
  abortSignal: AbortSignal,
  runProxy: RunProxyConfig,
): Promise<CrawlPageResult> {
  const { data: browser, error: connectError } = await tryCatch(
    withSpan(
      tracer,
      "crawlerWorker.crawlPage.getBrowserInstance",
      {
        attributes: {
          "job.id": jobId,
        },
      },
      async () => {
        if (serverConfig.crawler.browserConnectOnDemand) {
          return startBrowserInstance();
        }
        return getGlobalBrowser();
      },
    ),
  );
  if (connectError) {
    if (!serverConfig.crawler.browserFallbackToFetch) {
      throw connectError;
    }
    logger.warn(
      `[Crawler][${jobId}] Failed to connect to the browser, falling back to a plain fetch: ${connectError}`,
    );
    return browserlessCrawlPage(jobId, url, abortSignal, runProxy);
  }
  if (!browser) {
    return browserlessCrawlPage(jobId, url, abortSignal, runProxy);
  }
  // The session budget counts from the moment we hold a browser session.
  const budget = new SessionBudget(
    serverConfig.crawler.browserSessionBudgetSec,
  );

  const proxyConfig = getPlaywrightProxyConfig(runProxy);
  const isRunningInProxyContext =
    proxyConfig !== undefined &&
    !matchesNoProxy(url, proxyConfig.bypass?.split(",") ?? []);
  const { data: context, error: contextError } = await tryCatch(
    withSpan(
      tracer,
      "crawlerWorker.crawlPage.createContext",
      {
        attributes: {
          "job.id": jobId,
        },
      },
      async () =>
        browser.newContext({
          viewport: { width: 1440, height: 900 },
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          proxy: proxyConfig,
          serviceWorkers: "block",
        }),
    ),
  );
  if (contextError) {
    // Don't leave an on-demand (possibly remote, billed) session open.
    if (serverConfig.crawler.browserConnectOnDemand) {
      await browser.close().catch(() => {
        // Ignore errors — the browser may already be disconnected.
      });
    }
    throw contextError;
  }

  trackContext(jobId, context);
  let page: Page | undefined;
  try {
    const globalCookies = getGlobalCookies();
    if (globalCookies.length > 0) {
      await context.addCookies(globalCookies);
      logger.info(
        `[Crawler][${jobId}] Cookies successfully loaded into browser context`,
      );
    }

    const setup = await setupPage(context, jobId, proxyConfig, abortSignal);
    page = setup.page;
    const autoconsentHandle = setup.autoconsent;

    // page is guaranteed to be assigned here; alias to a const for
    // TypeScript narrowing so the rest of the try block sees `Page`.
    const activePage = page;

    // Navigate to the target URL
    const navigationValidation = await withSpan(
      tracer,
      "crawlerWorker.crawlPage.validateNavigationTarget",
      {
        attributes: {
          "job.id": jobId,
          "bookmark.url": url,
          "bookmark.domain": getBookmarkDomain(url),
        },
      },
      async () => validateUrl(url, isRunningInProxyContext),
    );
    if (!navigationValidation.ok) {
      throw new Error(
        `Disallowed navigation target "${truncateUrl(url)}": ${navigationValidation.reason}`,
      );
    }
    const targetUrl = navigationValidation.url.toString();
    logger.info(`[Crawler][${jobId}] Navigating to "${targetUrl}"`);
    const response = await withSpan(
      tracer,
      "crawlerWorker.crawlPage.navigate",
      {
        attributes: {
          "job.id": jobId,
          "bookmark.url": targetUrl,
          "bookmark.domain": getBookmarkDomain(targetUrl),
        },
      },
      async () =>
        raceWith(
          activePage.goto(targetUrl, {
            timeout: budget.navigationTimeoutMs(
              serverConfig.crawler.navigateTimeoutSec * 1000,
            ),
            waitUntil: "domcontentloaded",
          }),
          abortRaceResolve(abortSignal, null),
        ),
    );
    setSpanAttributes({
      "crawler.statusCode": response?.status() ?? 0,
    });

    logger.info(
      `[Crawler][${jobId}] Successfully navigated to "${targetUrl}". Waiting for the page to load ...`,
    );

    // Wait until network is relatively idle or timeout after 5 seconds.
    // Skipped when disabled or when it would eat into the capture reserve.
    const networkIdleWaitMs = 5000;
    const waitForNetworkIdle =
      serverConfig.crawler.waitForNetworkIdle && budget.fits(networkIdleWaitMs);
    const pageLoad = !waitForNetworkIdle
      ? Promise.resolve()
      : withSpan(
          tracer,
          "crawlerWorker.crawlPage.waitForLoadState",
          {
            attributes: {
              "job.id": jobId,
              "bookmark.url": targetUrl,
              "bookmark.domain": getBookmarkDomain(targetUrl),
            },
          },
          async () => {
            await raceWith<unknown>(
              activePage
                .waitForLoadState("networkidle", { timeout: networkIdleWaitMs })
                .catch(() => ({})),
              timeoutRace<unknown>(networkIdleWaitMs, () => undefined),
              abortRace(abortSignal),
            );
          },
        );

    // Autoconsent can wait twice for consent dialogs; skip those waits when
    // the session budget is too tight for them.
    const autoconsentWaitMs = 6000;
    await waitForPageLoadAndAutoconsent(
      pageLoad,
      budget.fits(autoconsentWaitMs) ? autoconsentHandle : undefined,
      abortSignal,
    );

    abortSignal.throwIfAborted();

    logger.info(`[Crawler][${jobId}] Finished waiting for the page to load.`);

    const [htmlContent, screenshot, pdf] = await capturePageAssets(
      activePage,
      jobId,
      forceStorePdf,
      abortSignal,
      budget,
    );

    return {
      htmlContent,
      statusCode: response?.status() ?? 0,
      screenshot,
      pdf,
      url: activePage.url(),
    };
  } finally {
    await closePageAndContext(page, context, browser, jobId);
  }
}
