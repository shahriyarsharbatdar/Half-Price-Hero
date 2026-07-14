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
 */

const PRODUCTS_URL = "https://www.woolworths.com.au/apis/ui/browse/category";
const SPECIALS_PAGE_URL = "https://www.woolworths.com.au/shop/browse/specials/half-price";
const MAX_PAGES = 100; // safety bound — real total is ~51 pages at 36/page

export async function scrapeWoolworths() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    let requestTemplate = null;
    page.on("requestfinished", (request) => {
      if (!requestTemplate && request.method() === "POST" && request.url().includes("/apis/ui/browse/category")) {
        requestTemplate = JSON.parse(request.postData());
      }
    });

    await page.goto(SPECIALS_PAGE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000); // let the page's own JS fire its first product request

    if (!requestTemplate) {
      throw new Error("Never saw a browse/category request — Woolworths' page structure may have changed");
    }

    const products = [];
    let pageNumber = 1;
    let total = Infinity;

    while ((pageNumber - 1) * requestTemplate.pageSize < total && pageNumber <= MAX_PAGES) {
      const res = await page.request.post(PRODUCTS_URL, {
        data: { ...requestTemplate, pageNumber },
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok()) {
        console.error(`Woolworths page ${pageNumber}: HTTP ${res.status()}, stopping`);
        break;
      }

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
      await new Promise((r) => setTimeout(r, 400)); // be a polite scraper
    }

    return products;
  } finally {
    await browser.close();
  }
}
