# Half Price Hero

Australian grocery-savings app: matches this week's Coles/Woolworths half-price
specials against the user's recipes, suggests chef's tips, estimates calories,
and plans meals across the week. Ingredients can be typed in any language.

## Layout

```
half-price-hero/
├── server/            Node/Express API
│   ├── src/index.js               routes
│   ├── src/store.js               JSON-file persistence (recipes, plan, recipe library, translation cache)
│   ├── src/data/specials.js       mock ½-price catalogue (Phase 2: real scraper)
│   ├── src/lib/matcher.js         ingredient ↔ special keyword matching (with light English stemming)
│   ├── src/lib/calories.js        rough kcal-per-serve estimates
│   ├── src/lib/translate.js       free, non-AI translation to English for matching (google-translate-api-x)
│   ├── src/lib/library-key.js     identity key for the recipe library (name + ingredients)
│   ├── src/lib/tips-rules.js      rule-based tips (offline fallback)
│   └── src/services/claude.js     AI chef's tips + suggested method via the Claude API
└── client/            React + Vite + Tailwind UI, wired to the API
    └── src/HalfPriceHero.jsx      the app (fetches everything from /api/*)
```

## Run

Two terminals:

```sh
# 1 — API
cd server
npm install
cp .env.example .env    # add ANTHROPIC_API_KEY for AI tips (optional)
npm run dev             # http://localhost:3001

# 2 — UI
cd client
npm install
npm run dev             # http://localhost:5173 (proxies /api → :3001)
```

Without an API key everything still works — chef's tips and calories fall back
to the rule-based engine (the tips panel shows an "offline tips" badge instead
of "✦ AI tips").

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/specials` | This week's ½-price items |
| GET | `/api/recipes` | Recipes, each with `analysis` (matches, saving) + `kcalPerServe` |
| POST | `/api/recipes` | `{ name, ingredients: string[] }` — ingredients are translated to English server-side for matching |
| DELETE | `/api/recipes/:id` | Delete recipe (also removed from the plan; the recipe **library** entry is untouched) |
| GET | `/api/matches` | Recipes with 2+ ingredients at half price |
| GET | `/api/recipes/:id/tips` | Chef's tips + method — `{ source, tips[], recipeSteps[], kcalPerServe, cached }`. Checks the recipe library first; only calls Claude on a miss. |
| GET | `/api/dishes/suggest?q=` | Autocomplete — dish names from the library matching `q`, with their ingredients |
| GET | `/api/plan` | Weekly plan with per-meal and weekly kcal |
| POST | `/api/plan` | `{ day: "Mon".."Sun", recipeId }` |
| DELETE | `/api/plan/:day/:index` | Remove a meal from a day |

## Multi-language ingredients

A recipe's `ingredients` (as typed, any language) are translated once at
creation time into `ingredientsEn` (stored alongside, never shown in the UI)
via `google-translate-api-x` — a free, unofficial wrapper around Google
Translate's public endpoint. No AI/LLM call, no API key, no per-request cost.

- ASCII-only text skips translation entirely (the common case — most
  ingredients are already English).
- Translations are cached in `store.js`'s `translations` map so the same
  phrase (e.g. "گوجه") never round-trips to the translator twice, even across
  different recipes.
- Matching (`lib/matcher.js`) runs on `ingredientsEn`, with light stemming
  (trailing "s"/"es") so e.g. "tomato" still matches catalogue text like
  "Truss **Tomatoes**".
- If the translation service is unreachable, the original text is used as-is
  (matching may simply miss for that ingredient until it's back — no crash).

**Trade-off to know about:** `google-translate-api-x` calls Google's public,
undocumented translate endpoint — free and unlimited in practice, but
unofficial. For a production deployment at real volume, consider swapping
`lib/translate.js` for the paid Google Cloud Translation API or a self-hosted
LibreTranslate instance; the rest of the app doesn't need to change.

## Recipe library (persistent, avoids re-billing Claude)

`store.js`'s `library` collection stores every dish's tips + method once
they're generated, keyed by `name + sorted(ingredientsEn)` (see
`lib/library-key.js`). It's independent of the user's active recipe list —
deleting a recipe does **not** delete its library entry.

- `GET /api/recipes/:id/tips` checks the library first. A hit returns
  instantly with `cached: true` and **no Claude call**. A miss calls Claude
  (or the rule-based fallback), then saves the result to the library.
- `GET /api/dishes/suggest?q=` powers autocomplete on the recipe-name field:
  as the user types, matching dish names from the library are suggested.
  Picking one fills in **both** name and ingredients exactly as stored, which
  guarantees the next tips request is a cache hit.
- The library persists to `data/db.json`, so it survives server restarts —
  tips are only ever generated once per distinct dish.

## Deploying (Render + Vercel)

The backend and frontend deploy as **two separate services** — a static site
can't run the Express API, and the API doesn't serve any HTML. The Vite dev
proxy (`client/vite.config.js`) only exists for local dev; the deployed client
talks to the deployed API via an absolute URL baked in at build time.

### 1. Backend → Render

1. New **Web Service** on [render.com](https://render.com), connected to this repo.
2. **Root Directory**: `server`
3. **Build Command**: `npm install`
4. **Start Command**: `npm start`
5. **Environment** → add `ANTHROPIC_API_KEY` with your key. Never put it in a
   committed file — Render injects it directly into `process.env`, which is
   why `npm start` runs plain `node src/index.js` (no `--env-file`, since
   there's no `.env` file on the server at all).
6. Deploy, then copy the resulting URL (`https://<your-service>.onrender.com`).
   `GET /` returns `{"status":"ok"}` — good for confirming it's actually up.

**Render's free tier disk is ephemeral** — `server/data/db.json` (recipes,
plan, recipe library) resets on every redeploy/restart. Fine for a demo; for
anything persistent, swap `store.js` for a real database (see Phase 2 below)
or attach a paid persistent disk.

### 2. Frontend → Vercel

1. New Project on [vercel.com](https://vercel.com), connected to this repo.
2. **Root Directory**: `client` (Framework Preset auto-detects as Vite).
3. **Environment Variables** → add `VITE_API_URL` = your Render URL from step
   1 (e.g. `https://half-price-hero-backend.onrender.com`, no trailing
   slash). Must be set **before** the first build — Vite only reads
   `VITE_`-prefixed env vars at build time, not at runtime, so changing it
   later requires a redeploy.
4. Deploy.

### Common failure modes

| Symptom | Cause |
|---|---|
| Frontend loads but every request 404s / network-errors | `VITE_API_URL` missing or wrong at build time — check it's set in Vercel, then **redeploy** (env var changes don't apply retroactively to an old build) |
| Backend won't start on Render, exits immediately | Leftover `--env-file=.env` in `start` (fixed here — there's no `.env` on Render, only injected env vars) |
| CORS error in the browser console | Shouldn't happen — `cors()` is unrestricted by default. If you later lock it down to a specific origin, make sure it matches the exact Vercel URL |
| Recipes/plan reset unexpectedly | Expected on Render's free tier — the filesystem is ephemeral (see above) |

## Client wiring notes

- Chef's tips are lazy-loaded the first time a recipe's tips panel is opened.
  The panel shows a "Suggested method" (numbered steps) above "Tips", and a
  badge indicating the source: "✦ AI tips" (fresh Claude call), "📚 saved
  recipe — no AI call" (library hit), or "offline tips" (no API key configured).
- Matching, savings, and calories all come from the server — the client is
  purely presentational.

## Phase 2 swap points

- `server/src/data/specials.js` → catalogue scraper/API, refreshed each Wednesday
- `server/src/store.js` → SQLite/Postgres (all persistence goes through `getState`/`saveState`)
- `server/src/lib/calories.js` → nutrition API (FoodData Central / Edamam)
- `server/src/lib/translate.js` → paid Cloud Translation API or self-hosted LibreTranslate, if the free endpoint becomes unreliable at scale
- Notifications: cron job on catalogue day → run the matcher → push/email users
