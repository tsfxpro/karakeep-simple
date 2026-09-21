import { describe, expect, test } from "vitest";

import {
  CAPTURE_RESERVE_MS,
  createSessionLimiter,
  SessionBudget,
  shouldResolveBrowserHostname,
} from "./browserSession";

describe("shouldResolveBrowserHostname", () => {
  test("resolves plain http/ws endpoints", () => {
    expect(shouldResolveBrowserHostname(new URL("http://chrome:9222"))).toBe(
      true,
    );
    expect(shouldResolveBrowserHostname(new URL("ws://chrome:9222"))).toBe(
      true,
    );
  });

  test("keeps the hostname for TLS endpoints", () => {
    expect(
      shouldResolveBrowserHostname(
        new URL("wss://production-sfo.browserless.io?token=x"),
      ),
    ).toBe(false);
    expect(
      shouldResolveBrowserHostname(new URL("https://chrome.example.com")),
    ).toBe(false);
  });
});

describe("createSessionLimiter", () => {
  test("without a max, acquiring never blocks", async () => {
    const limiter = createSessionLimiter(undefined);
    const signal = new AbortController().signal;
    const releases = await Promise.all([
      limiter.acquire(signal),
      limiter.acquire(signal),
      limiter.acquire(signal),
    ]);
    expect(releases).toHaveLength(3);
  });

  test("allows only max concurrent sessions", async () => {
    const limiter = createSessionLimiter(1);
    const signal = new AbortController().signal;
    const releaseFirst = await limiter.acquire(signal);

    let secondAcquired = false;
    const second = limiter.acquire(signal).then((release) => {
      secondAcquired = true;
      return release;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(secondAcquired).toBe(false);

    releaseFirst();
    const releaseSecond = await second;
    expect(secondAcquired).toBe(true);
    releaseSecond();
  });

  test("aborting while waiting rejects and does not leak the slot", async () => {
    const limiter = createSessionLimiter(1);
    const releaseFirst = await limiter.acquire(new AbortController().signal);

    const controller = new AbortController();
    const waiting = limiter.acquire(controller.signal);
    controller.abort(new Error("job timed out"));
    await expect(waiting).rejects.toThrow("job timed out");

    releaseFirst();
    // The aborted waiter must hand its slot back, so this doesn't hang.
    const release = await limiter.acquire(new AbortController().signal);
    release();
  });

  test("rejects immediately when already aborted", async () => {
    const limiter = createSessionLimiter(1);
    const controller = new AbortController();
    controller.abort(new Error("aborted"));
    await expect(limiter.acquire(controller.signal)).rejects.toThrow("aborted");
  });
});

describe("SessionBudget", () => {
  test("without a budget, timeouts are unchanged and everything fits", () => {
    const budget = new SessionBudget(undefined);
    expect(budget.limited).toBe(false);
    expect(budget.navigationTimeoutMs(30_000)).toBe(30_000);
    expect(budget.fits(1_000_000)).toBe(true);
  });

  test("caps navigation to the remaining budget minus the capture reserve", () => {
    let now = 0;
    const budget = new SessionBudget(50, () => now);
    expect(budget.navigationTimeoutMs(30_000)).toBe(30_000);

    now = 25_000;
    expect(budget.navigationTimeoutMs(30_000)).toBe(
      50_000 - 25_000 - CAPTURE_RESERVE_MS,
    );

    now = 49_000;
    expect(budget.navigationTimeoutMs(30_000)).toBe(1_000);
  });

  test("optional steps only fit before the capture reserve", () => {
    let now = 0;
    const budget = new SessionBudget(20, () => now);
    expect(budget.fits(5_000)).toBe(true);

    now = 6_000;
    // 14s left, 4s after the reserve
    expect(budget.fits(5_000)).toBe(false);
    expect(budget.fits(4_000)).toBe(true);
  });
});
