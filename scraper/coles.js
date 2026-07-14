/**
 * Coles half-price specials.
 *
 * coles.com.au is server-rendered (Next.js) and embeds the full product list
 * as JSON via <script id="__NEXT_DATA__">, so no DOM scraping/selectors are
 * needed — just load the page and read that script tag's contents.
 *
 * A plain HTTP request (Node's fetch, or most non-browser HTTP clients) gets
 * served a "Pardon Our Interruption" bot-challenge page instead of the real
 * one — confirmed manually, this is TLS-fingerprint based (curl slips
 * through, Node's fetch doesn't), so this uses Playwright for a genuine
 * browser fingerprint. Unlike Woolworths, Coles does NOT block headless mode.
 *
 * Verified manually: https://www.coles.com.au/on-special?filter_Special=halfprice
 * returns exactly the "Half price" filter count (~1200 items at time of
 * writing), paginated 48/page via ?page=N.
 */

const MAX_PAGES = 60; // safety bound — real total is ~26 pages at 48/page

async function fetchPage(page, pageNumber) {
  const res = await page.goto(`https://www.coles.com.au/on-special?filter_Special=halfprice&page=${pageNumber}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  if (!res.ok()) throw new Error(`HTTP ${res.status()}`);

  const nextData = await page.evaluate(() => {
    const el = document.getElementById("__NEXT_DATA__");
    return el ? el.textContent : null;
  });
  if (!nextData) throw new Error("no __NEXT_DATA__ element — likely a bot-challenge page");

  const searchResults = JSON.parse(nextData)?.props?.pageProps?.searchResults;
  if (!searchResults) throw new Error("__NEXT_DATA__ present but missing props.pageProps.searchResults");
  return searchResults;
}

export async function scrapeColes() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    const products = [];
    let pageNumber = 1;
    let total = Infinity;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 5; // a handful of blips is normal; this many in a row means genuinely blocked

    while ((pageNumber - 1) * 48 < total && pageNumber <= MAX_PAGES) {
      let searchResults;
      try {
        searchResults = await fetchPage(page, pageNumber);
      } catch (err) {
        console.error(`Coles page ${pageNumber} failed (${err.message}), retrying once...`);
        await page.waitForTimeout(1500);
        try {
          searchResults = await fetchPage(page, pageNumber);
        } catch (err2) {
          console.error(`Coles page ${pageNumber} failed again (${err2.message}), skipping this page`);
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            console.error(`${MAX_CONSECUTIVE_FAILURES} pages in a row failed — stopping (likely genuinely blocked)`);
            break;
          }
          pageNumber++;
          continue;
        }
      }
      consecutiveFailures = 0;

      total = searchResults.noOfResults ?? 0;
      for (const p of searchResults.results ?? []) {
        if (p._type !== "PRODUCT") continue;
        const { was, now } = p.pricing ?? {};
        if (!(was > 0 && now > 0 && was > now)) continue; // guard against non-markdown entries
        products.push({
          id: `coles-${p.id}`,
          name: p.size ? `${p.name} ${p.size}` : p.name,
          category: p.onlineHeirs?.[0]?.category || p.merchandiseHeir?.category || "Grocery",
          store: "coles",
          was,
          now,
        });
      }

      pageNumber++;
      await page.waitForTimeout(500); // be a polite scraper
    }

    return products;
  } finally {
    await browser.close();
  }
}
