/**
 * Free, code-only measures to make the browser look less like an automated
 * one and less like it's coming from a datacenter — no paid proxy, just a
 * more convincing fingerprint + politer pacing. This narrows the gap between
 * "works from a home IP" and "works from a GitHub Actions runner", but can't
 * fully close it if a site outright blocklists cloud/datacenter IP ranges
 * (that needs a residential proxy, which is a separate, paid decision).
 */

export const AU_CONTEXT_OPTIONS = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
  locale: "en-AU",
  timezoneId: "Australia/Sydney",
  extraHTTPHeaders: {
    "Accept-Language": "en-AU,en;q=0.9",
  },
};

/**
 * Patches the handful of navigator/window properties that headless Chromium
 * leaves in a detectably-different state from a real browser. Must run via
 * addInitScript (before any page script executes), not page.evaluate after
 * the fact.
 */
export async function applyStealth(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["en-AU", "en"] });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    window.chrome = window.chrome || { runtime: {} };
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (params) =>
        params.name === "notifications"
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(params);
    }
  });
}

/** Random delay in [min, max] ms — avoids the dead-giveaway of identical fixed-interval requests. */
export function jitter(min, max) {
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}
