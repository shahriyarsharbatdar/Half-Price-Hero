import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tiny JSON-file store for recipes, weekly plan, the recipe library (persisted
 * AI tips/method so we don't re-bill Claude for a dish we've already seen),
 * and a small ingredient-translation cache.
 * Phase 2: replace with Postgres/SQLite; the route handlers only touch
 * getState()/saveState() so the swap is contained here.
 */

const DB_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "db.json");

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SEED = {
  nextId: 5,
  recipes: [
    { id: 1, name: "Tuna Pasta Bake",      ingredients: ["Pasta Sauce", "Tuna", "Spaghetti", "Cheese"], ingredientsEn: ["Pasta Sauce", "Tuna", "Spaghetti", "Cheese"] },
    { id: 2, name: "Weeknight Fried Rice", ingredients: ["Basmati Rice", "Soy Sauce", "Eggs", "Peas"], ingredientsEn: ["Basmati Rice", "Soy Sauce", "Eggs", "Peas"] },
    { id: 3, name: "Tomato & Feta Salad",  ingredients: ["Olive Oil", "Tomatoes", "Feta"], ingredientsEn: ["Olive Oil", "Tomatoes", "Feta"] },
    { id: 4, name: "Sunday Roast",         ingredients: ["Beef", "Potatoes", "Gravy"], ingredientsEn: ["Beef", "Potatoes", "Gravy"] },
  ],
  plan: { Mon: [1], Tue: [], Wed: [2], Thu: [], Fri: [3], Sat: [], Sun: [] },
  // Persisted recipe knowledge base — keyed by name+ingredients signature (see
  // lib/library.js). Survives recipe deletion so a dish's tips are only ever
  // generated once, no matter how many times it's re-added.
  library: [],
  // ingredient text (lowercased) -> English translation, so repeat ingredient
  // strings across recipes never hit the translation service twice.
  translations: {},
};

let state = null;

export function getState() {
  if (state) return state;
  if (existsSync(DB_PATH)) {
    state = JSON.parse(readFileSync(DB_PATH, "utf8"));
    migrate(state);
  } else {
    state = structuredClone(SEED);
    saveState();
  }
  return state;
}

export function saveState() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

/** Backfill fields for db.json files written before library/translations/ingredientsEn existed. */
function migrate(s) {
  s.library ??= [];
  s.translations ??= {};
  for (const recipe of s.recipes) {
    recipe.ingredientsEn ??= recipe.ingredients;
  }
}

export function getCachedTranslation(text) {
  return getState().translations[text.toLowerCase()];
}

export function setCachedTranslation(text, english) {
  getState().translations[text.toLowerCase()] = english;
}

export function findLibraryEntry(key) {
  return getState().library.find((e) => e.key === key);
}

export function upsertLibraryEntry(entry) {
  const s = getState();
  s.library = s.library.filter((e) => e.key !== entry.key);
  s.library.push(entry);
}

/** Case-insensitive substring match on dish name, most-recently-updated first. */
export function suggestLibraryEntries(query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return getState()
    .library.filter((e) => e.name.toLowerCase().includes(q))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit);
}
