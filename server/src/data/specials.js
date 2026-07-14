/**
 * Seed ½-price catalogue — used only until the daily scraper (see
 * ../../../scraper/) POSTs real data to /api/admin/specials for the first
 * time. After that, store.js's persisted `specials` takes over; this file is
 * just what a brand-new deploy shows before the first scrape runs.
 */
export const SPECIALS = [
  { id: "sp-1",  name: "Leggo's Pasta Sauce 500g", category: "Pantry",        store: "coles",   was: 3.5, now: 1.75 },
  { id: "sp-2",  name: "SunRice Basmati Rice 1kg", category: "Pantry",        store: "woolies", was: 4.0, now: 2.0 },
  { id: "sp-3",  name: "Sirena Tuna Cans 425g",    category: "Canned",        store: "coles",   was: 3.2, now: 1.6 },
  { id: "sp-4",  name: "Bertolli Olive Oil 500ml", category: "Pantry",        store: "woolies", was: 9.0, now: 4.5 },
  { id: "sp-5",  name: "San Remo Spaghetti 500g",  category: "Pasta",         store: "coles",   was: 2.0, now: 1.0 },
  { id: "sp-6",  name: "Bega Block Cheese 500g",   category: "Dairy",         store: "woolies", was: 8.0, now: 4.0 },
  { id: "sp-7",  name: "Kikkoman Soy Sauce 250ml", category: "Pantry",        store: "coles",   was: 3.0, now: 1.5 },
  { id: "sp-8",  name: "Free Range Eggs 12pk",     category: "Dairy",         store: "woolies", was: 6.0, now: 3.0 },
  { id: "sp-9",  name: "Cadbury Dairy Milk 180g",  category: "Confectionery", store: "coles",   was: 5.0, now: 2.5 },
  { id: "sp-10", name: "Truss Tomatoes 1kg",       category: "Produce",       store: "woolies", was: 5.0, now: 2.5 },
];
