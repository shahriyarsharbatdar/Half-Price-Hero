import express from "express";
import cors from "cors";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyseRecipe } from "./lib/matcher.js";
import { estimateCalories } from "./lib/calories.js";
import { translateIngredients } from "./lib/translate.js";
import { libraryKey } from "./lib/library-key.js";
import { tipsForRecipe } from "./services/claude.js";
import { extractSpecialsFromCatalogue } from "./services/catalogue.js";
import {
  getState,
  saveState,
  findLibraryEntry,
  upsertLibraryEntry,
  suggestLibraryEntries,
  getSpecials,
  setSpecials,
  mergeSpecialsForStore,
  getSpecialsUpdatedAt,
  DAYS,
} from "./store.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
// Real catalogues run 25-30MB+ (confirmed against actual Coles/Woolworths exports) — well
// past a typical "attachment" size, so the cap here is generous on purpose.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } }); // 60MB PDF cap

// Catalogue extraction runs for minutes on a real catalogue (many chunked Claude calls) —
// too long to hold open a single request/response through a platform proxy (Render's
// included) without risking a gateway timeout. So the upload endpoint kicks off
// processing and returns immediately with a job id; the client polls for status.
// In-memory only — fine for a low-frequency, single-operator admin tool; a job is lost
// on server restart, which just means re-uploading.
const catalogueJobs = new Map();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR)); // serves public/admin.html at /admin.html

function requireAdminToken(req, res, next) {
  const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!process.env.SCRAPER_TOKEN || token !== process.env.SCRAPER_TOKEN) {
    return res.status(401).json({ error: "invalid or missing token" });
  }
  next();
}

const withAnalysis = (recipe) => ({
  ...recipe,
  analysis: analyseRecipe(recipe, getSpecials()),
  kcalPerServe: estimateCalories(recipe),
});

/* ---- Health check (Render pings "/" to confirm the service is up) ---- */
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "half-price-hero-api" });
});

/* ---- Specials ---- */
app.get("/api/specials", (_req, res) => {
  res.json(getSpecials());
});

/* ---- Admin: bulk specials replace — used by the (currently disabled) scraper, see ../../scraper/ ---- */
app.post("/api/admin/specials", requireAdminToken, (req, res) => {
  const { specials } = req.body ?? {};
  if (!Array.isArray(specials) || specials.length === 0) {
    return res.status(400).json({ error: "specials must be a non-empty array" });
  }
  const valid = specials.every(
    (s) =>
      typeof s.id === "string" &&
      typeof s.name === "string" &&
      (s.store === "coles" || s.store === "woolies") &&
      typeof s.was === "number" &&
      typeof s.now === "number"
  );
  if (!valid) {
    return res.status(400).json({ error: "each special needs id, name, store ('coles'|'woolies'), was, now" });
  }

  setSpecials(specials);
  saveState();
  res.json({ count: specials.length, specialsUpdatedAt: getSpecialsUpdatedAt() });
});

/* ---- Admin: extract specials from an uploaded catalogue PDF for one store,
   used by the /admin.html page (see services/catalogue.js). Starts a background
   job and returns its id immediately — see catalogueJobs comment above. ---- */
app.post("/api/admin/catalogue", requireAdminToken, upload.single("catalogue"), (req, res) => {
  const store = req.body?.store;
  if (store !== "coles" && store !== "woolies") {
    return res.status(400).json({ error: "store must be 'coles' or 'woolies'" });
  }
  if (!req.file) {
    return res.status(400).json({ error: "no file uploaded (field name must be 'catalogue')" });
  }
  if (req.file.mimetype !== "application/pdf") {
    return res.status(400).json({ error: "only application/pdf is supported" });
  }

  const jobId = randomUUID();
  catalogueJobs.set(jobId, { status: "processing", store, completed: 0, total: 0 });
  res.status(202).json({ jobId });

  extractSpecialsFromCatalogue(req.file.buffer, (completed, total) => {
    const job = catalogueJobs.get(jobId);
    if (job) Object.assign(job, { completed, total });
  })
    .then((items) => {
      if (items.length === 0) {
        catalogueJobs.set(jobId, { status: "error", store, error: "no discounted items were found in this PDF" });
        return;
      }
      mergeSpecialsForStore(store, items);
      saveState();
      catalogueJobs.set(jobId, { status: "done", store, count: items.length, specialsUpdatedAt: getSpecialsUpdatedAt() });
    })
    .catch((err) => {
      catalogueJobs.set(jobId, { status: "error", store, error: err.message });
    });
});

/* ---- Admin: poll a catalogue extraction job started above ---- */
app.get("/api/admin/catalogue/:jobId", requireAdminToken, (req, res) => {
  const job = catalogueJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(job);
});

/* ---- Recipes ---- */
app.get("/api/recipes", (_req, res) => {
  res.json(getState().recipes.map(withAnalysis));
});

app.post("/api/recipes", async (req, res) => {
  const { name, ingredients } = req.body ?? {};
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!Array.isArray(ingredients) || ingredients.length === 0 || !ingredients.every((i) => typeof i === "string" && i.trim())) {
    return res.status(400).json({ error: "ingredients must be a non-empty array of strings" });
  }
  const trimmedIngredients = ingredients.map((i) => i.trim());
  // Translate once at creation time (not on every match/analysis) so ingredients
  // typed in any language still line up with the English-only specials catalogue.
  const ingredientsEn = await translateIngredients(trimmedIngredients);

  const state = getState();
  const recipe = { id: state.nextId++, name: name.trim(), ingredients: trimmedIngredients, ingredientsEn };
  state.recipes.unshift(recipe);
  saveState();
  res.status(201).json(withAnalysis(recipe));
});

app.delete("/api/recipes/:id", (req, res) => {
  const id = Number(req.params.id);
  const state = getState();
  const before = state.recipes.length;
  state.recipes = state.recipes.filter((r) => r.id !== id);
  if (state.recipes.length === before) return res.status(404).json({ error: "recipe not found" });
  for (const day of DAYS) state.plan[day] = state.plan[day].filter((rid) => rid !== id);
  saveState();
  res.status(204).end();
});

/* ---- Weekly matcher ---- */
app.get("/api/matches", (_req, res) => {
  const matches = getState()
    .recipes.map(withAnalysis)
    .filter((r) => r.analysis.isMatch)
    .sort((a, b) => b.analysis.count - a.analysis.count);
  res.json(matches);
});

/* ---- Chef's tips (persistent library first, Claude API / rule-based fallback on a miss) ---- */
app.get("/api/recipes/:id/tips", async (req, res) => {
  const state = getState();
  const recipe = state.recipes.find((r) => r.id === Number(req.params.id));
  if (!recipe) return res.status(404).json({ error: "recipe not found" });

  const key = libraryKey(recipe.name, recipe.ingredientsEn ?? recipe.ingredients);
  const cached = findLibraryEntry(key);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  const result = await tipsForRecipe(recipe);
  upsertLibraryEntry({
    key,
    name: recipe.name,
    ingredients: recipe.ingredients,
    ingredientsEn: recipe.ingredientsEn ?? recipe.ingredients,
    updatedAt: new Date().toISOString(),
    ...result,
  });
  saveState();
  res.json({ ...result, cached: false });
});

/* ---- Dish name autocomplete — suggests from the recipe library so users don't
   retype a dish (and creating it reuses the cached tips, no AI call) ---- */
app.get("/api/dishes/suggest", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  res.json(
    suggestLibraryEntries(q).map((e) => ({
      name: e.name,
      ingredients: e.ingredients,
      kcalPerServe: e.kcalPerServe,
    }))
  );
});

/* ---- Meal planner ---- */
app.get("/api/plan", (_req, res) => {
  const state = getState();
  const byId = new Map(state.recipes.map((r) => [r.id, r]));
  const plan = Object.fromEntries(
    DAYS.map((day) => [
      day,
      state.plan[day]
        .map((rid) => byId.get(rid))
        .filter(Boolean)
        .map((r) => ({ id: r.id, name: r.name, kcalPerServe: estimateCalories(r) })),
    ])
  );
  const weekKcal = DAYS.reduce((sum, d) => sum + plan[d].reduce((s, m) => s + m.kcalPerServe, 0), 0);
  res.json({ plan, weekKcal });
});

app.post("/api/plan", (req, res) => {
  const { day, recipeId } = req.body ?? {};
  const state = getState();
  if (!DAYS.includes(day)) return res.status(400).json({ error: `day must be one of ${DAYS.join(", ")}` });
  if (!state.recipes.some((r) => r.id === recipeId)) return res.status(404).json({ error: "recipe not found" });
  state.plan[day].push(recipeId);
  saveState();
  res.status(201).json({ day, recipeId });
});

app.delete("/api/plan/:day/:index", (req, res) => {
  const { day } = req.params;
  const index = Number(req.params.index);
  const state = getState();
  if (!DAYS.includes(day) || !(index >= 0 && index < state.plan[day].length)) {
    return res.status(404).json({ error: "plan entry not found" });
  }
  state.plan[day].splice(index, 1);
  saveState();
  res.status(204).end();
});

// Multer errors (e.g. file too large) land here instead of Express's default
// HTML error page — must be registered after all routes, with 4 params.
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `upload error: ${err.message}` });
  }
  next(err);
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  const tipsMode = process.env.ANTHROPIC_API_KEY ? "Claude API" : "rule-based fallback (no ANTHROPIC_API_KEY)";
  console.log(`Half Price Hero API on http://localhost:${PORT} — chef's tips: ${tipsMode}`);
});
