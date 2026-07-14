import { scrapeColes } from "./coles.js";
import { scrapeWoolworths } from "./woolworths.js";

const BACKEND_URL = process.env.BACKEND_URL;
const SCRAPER_TOKEN = process.env.SCRAPER_TOKEN;

if (!BACKEND_URL || !SCRAPER_TOKEN) {
  console.error("Missing BACKEND_URL or SCRAPER_TOKEN environment variables.");
  process.exit(1);
}

async function main() {
  console.log("Scraping Coles half-price specials...");
  const coles = await scrapeColes().catch((err) => {
    console.error("Coles scrape failed:", err.message);
    return [];
  });
  console.log(`Coles: ${coles.length} half-price items`);

  console.log("Scraping Woolworths half-price specials...");
  const woolies = await scrapeWoolworths().catch((err) => {
    console.error("Woolworths scrape failed:", err.message);
    return [];
  });
  console.log(`Woolworths: ${woolies.length} half-price items`);

  const specials = [...coles, ...woolies];

  // If both scrapers came back empty, a site almost certainly changed its
  // structure (or started blocking us) — better to keep yesterday's data and
  // fail loudly than silently wipe the catalogue to empty.
  if (specials.length === 0) {
    console.error("Both scrapers returned zero items — not uploading. Check for a site/anti-bot change.");
    process.exit(1);
  }

  console.log(`Uploading ${specials.length} total items to ${BACKEND_URL}...`);
  const res = await fetch(`${BACKEND_URL}/api/admin/specials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SCRAPER_TOKEN}`,
    },
    body: JSON.stringify({ specials }),
  });

  if (!res.ok) {
    console.error("Upload failed:", res.status, await res.text());
    process.exit(1);
  }

  console.log("Done.");
}

main();
