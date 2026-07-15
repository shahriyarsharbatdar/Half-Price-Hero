/**
 * Woolworths half-price specials — requires a real browser.
 *
 * woolworths.com.au sits behind Akamai bot protection that specifically
 * blocks headless Chromium (confirmed manually: headless -> "Access Denied"
 * from errors.edgesuite.net; headed -> loads fine). So this MUST launch with
 * headless: false, which in turn means the environment running it needs a
 * display — see .github/workflows/scrape-specials.yml, which runs this under
 * xvfb-run (a virtual display) for exactly that reason.
 *
 * The product grid isn't in the page's initial HTML (it's an AEM content
 * shell); the page's own JS calls POST /apis/ui/browse/category to fetch it.
 * Rather than hardcode that request's body (its categoryId is an internal
 * Woolworths identifier that could change), we capture the real request the
 * page makes on first load and reuse its shape for subsequent pages within
 * the same authenticated browser session/cookies.
 *
 * Known limitation: from a datacenter IP (e.g. a GitHub Actions runner),
 * Akamai has been observed blocking even the headed first page load — headed
 * mode fixes the headless-specific block, but can't fix an IP-range-based
 * one. This file applies free mitigations only (see stealth.js — realistic
 * fingerprint, AU locale/timezone, randomized pacing, one retry on a fresh
 * session). If it's still unreliable after that, the remaining fix is a
 * residential proxy (paid) so requests originate from a non-datacenter IP.
 */

import { AU_CONTEXT_OPTIONS, applyStealth, jitter } from "./stealth.js";

const PRODUCTS_URL = "https://www.woolworths.com.au/apis/ui/browse/category";
const SPECIALS_PAGE_URL = "https://www.woolworths.com.au/shop/browse/specials/half-price";
const MAX_PAGES = 100; // safety bound — real total is ~51 pages at 36/page

/** One full attempt: open a fresh context, load the specials page, capture the request template. */
async function loadSpecialsPage(browser) {
  const context = await browser.newContext(AU_CONTEXT_OPTIONS);
  await applyStealth(context);
  const page = await context.newPage();

  let requestTemplate = null;
  page.on("requestfinished", (request) => {
    if (!requestTemplate && request.method() === "POST" && request.url().includes("/apis/ui/browse/category")) {
      try {
        requestTemplate = JSON.parse(request.postData());
      } catch {
        /* ignore — keep waiting for a well-formed one */
      }
    }
  });

  const res = await page.goto(SPECIALS_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  if (!res.ok()) {
    await context.close();
    throw new Error(`page load returned HTTP ${res.status()}`);
  }
  await page.waitForTimeout(3500); // let the page's own JS fire its first product request

  if (!requestTemplate) {
    await context.close();
    throw new Error("never saw a browse/category request — blocked, or the page structure changed");
  }

  return { context, page, requestTemplate };
}

export async function scrapeWoolworths() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    // A small pre-navigation delay avoids the tell of hitting the site the
    // instant the process starts. If the first attempt looks blocked, retry
    // once with an entirely fresh context (new cookies/session) rather than
    // reusing one that may already be flagged.
    await jitter(1000, 3000);
    let loaded;
    try {
      loaded = await loadSpecialsPage(browser);
    } catch (err) {
      console.error(`Woolworths initial page load failed (${err.message}), retrying with a fresh session...`);
      await jitter(3000, 6000);
      loaded = await loadSpecialsPage(browser);
    }
    const { page, requestTemplate } = loaded;

    const products = [];
    let pageNumber = 1;
    let total = Infinity;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 5;

    while ((pageNumber - 1) * requestTemplate.pageSize < total && pageNumber <= MAX_PAGES) {
      const res = await page.request.post(PRODUCTS_URL, {
        data: { ...requestTemplate, pageNumber },
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok()) {
        console.error(`Woolworths page ${pageNumber}: HTTP ${res.status()}`);
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          console.error(`${MAX_CONSECUTIVE_FAILURES} pages in a row failed — stopping (likely genuinely blocked)`);
          break;
        }
        pageNumber++;
        await jitter(2000, 4000);
        continue;
      }
      consecutiveFailures = 0;

      const json = await res.json();
      total = json.TotalRecordCount ?? 0;
      for (const bundle of json.Bundles ?? []) {
        for (const p of bundle.Products ?? []) {
          if (!p.IsHalfPrice) continue;
          products.push({
            id: `woolies-${p.Stockcode}`,
            name: p.DisplayName || p.Name,
            category: bundle.DisplayName || bundle.Name || "Grocery",
            store: "woolies",
            was: p.WasPrice,
            now: p.Price,
          });
        }
      }

      pageNumber++;
      await jitter(pageNumber % 5 === 0 ? 3000 : 600, pageNumber % 5 === 0 ? 6000 : 1600);
    }

    return products;
  } finally {
    await browser.close();
  }
}
