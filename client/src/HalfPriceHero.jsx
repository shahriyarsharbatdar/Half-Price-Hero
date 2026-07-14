import { useCallback, useEffect, useMemo, useState } from "react";

/* =========================================================================
 * Half Price Hero — client, wired to the Express API (../server)
 *
 * All domain logic now lives server-side:
 *  - matching + savings      → GET /api/recipes (each recipe carries `analysis`;
 *                              ingredients are translated server-side so any
 *                              language still matches the English catalogue)
 *  - calorie estimates       → `kcalPerServe` on recipes and plan meals
 *  - chef's tips + method    → GET /api/recipes/:id/tips — checks the persistent
 *                              recipe library first, Claude API / rule-based
 *                              fallback only on a miss; lazy-loaded on expand
 *  - dish autocomplete       → GET /api/dishes/suggest?q= (recipe-name field)
 *  - weekly plan             → GET/POST/DELETE /api/plan
 *
 * Requests go through API_BASE + /api/* :
 *  - Local dev: VITE_API_URL is unset, so API_BASE is "" and requests go to
 *    relative /api/* paths, which the Vite dev server proxies to
 *    http://localhost:3001 (see vite.config.js).
 *  - Deployed build: set VITE_API_URL (in Vercel's project env vars, at
 *    build time) to the deployed backend's URL, e.g.
 *    https://half-price-hero-backend.onrender.com — Vite bakes it into the
 *    build, since a static host has no dev-proxy equivalent.
 * ========================================================================= */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MATCH_THRESHOLD = 2;
const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function api(path, options) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: options?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

const aud = (n) => `$${n.toFixed(2)}`;

/* ---------------------------------------------------------------------------
 * Presentational components
 * ------------------------------------------------------------------------- */
function StatTile({ label, value, tone = "default" }) {
  const toneClass = {
    default: "text-stone-900 dark:text-stone-100",
    gold: "text-amber-600 dark:text-amber-400",
    good: "text-emerald-700 dark:text-emerald-400",
  }[tone];
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <div className="text-xs text-stone-500 dark:text-stone-400">{label}</div>
      <div className={`mt-1 text-3xl font-extrabold tabular-nums tracking-tight ${toneClass}`}>{value}</div>
    </div>
  );
}

function KcalChip({ kcal }) {
  return (
    <span className="whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-extrabold tabular-nums text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
      ~{kcal} kcal
    </span>
  );
}

function IngredientChip({ label, onSpecial, small }) {
  const base = small ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1";
  return onSpecial ? (
    <span className={`${base} rounded-lg bg-emerald-100 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300`}>
      ½ {label}
    </span>
  ) : (
    <span className={`${base} rounded-lg border border-stone-200 bg-stone-100 text-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400`}>
      {label}
    </span>
  );
}

/** Chef's tips — lazy-loaded from the API the first time the section opens. */
function ChefTips({ recipeId }) {
  const [state, setState] = useState({ status: "idle", data: null });

  const load = async () => {
    if (state.status !== "idle") return;
    setState({ status: "loading", data: null });
    try {
      setState({ status: "ready", data: await api(`/recipes/${recipeId}/tips`) });
    } catch (err) {
      setState({ status: "error", data: err.message });
    }
  };

  return (
    <details
      className="mt-2.5 border-t border-dashed border-stone-200 pt-2 dark:border-stone-700"
      onToggle={(e) => e.currentTarget.open && load()}
    >
      <summary className="cursor-pointer select-none text-xs font-extrabold text-amber-600 dark:text-amber-400">
        Chef's tips
      </summary>
      {state.status === "loading" && (
        <p className="mt-2 animate-pulse text-[13px] text-stone-400">Asking the chef…</p>
      )}
      {state.status === "error" && (
        <p className="mt-2 text-[13px] text-red-500">Couldn't load tips: {state.data}</p>
      )}
      {state.status === "ready" && (
        <>
          {state.data.recipeSteps?.length > 0 && (
            <div className="mt-2">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-400">
                Suggested method
              </p>
              <ol className="flex flex-col gap-1.5">
                {state.data.recipeSteps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-snug text-stone-600 dark:text-stone-300">
                    <span className="flex-none font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {i + 1}.
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p
            className={`mb-1.5 text-[11px] font-bold uppercase tracking-wide text-stone-400 ${
              state.data.recipeSteps?.length
                ? "mt-3 border-t border-dashed border-stone-200 pt-2 dark:border-stone-700"
                : "mt-2"
            }`}
          >
            Tips
          </p>
          <ul className="flex flex-col gap-1.5">
            {state.data.tips.map((tip) => (
              <li key={tip} className="flex gap-2 text-[13px] leading-snug text-stone-500 dark:text-stone-400">
                <span aria-hidden className="flex-none text-xs">👨‍🍳</span>
                {tip}
              </li>
            ))}
          </ul>
          <span className="mt-2 inline-block rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-400 dark:bg-stone-800">
            {state.data.cached
              ? "📚 saved recipe — no AI call"
              : state.data.source === "claude"
              ? "✦ AI tips"
              : "offline tips"}
          </span>
        </>
      )}
    </details>
  );
}

function MatchCard({ recipe }) {
  const { analysis } = recipe;
  const matched = new Set(analysis.matchedIngredients);
  return (
    <div className="relative overflow-hidden rounded-xl border border-amber-300 bg-white p-4 shadow-sm dark:border-amber-500/40 dark:bg-stone-900">
      <span className="absolute inset-y-0 left-0 w-1 bg-amber-500" />
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-base font-extrabold tracking-tight text-stone-900 dark:text-stone-100">{recipe.name}</span>
        <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700 dark:border-amber-500/40 dark:bg-amber-900/40 dark:text-amber-300">
          Match
        </span>
      </div>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-stone-500 dark:text-stone-400">
        <span>
          <b className="text-emerald-700 dark:text-emerald-400">{analysis.count} of {recipe.ingredients.length}</b>{" "}
          ingredients at half price
        </span>
        <KcalChip kcal={recipe.kcalPerServe} />
      </p>
      <div className="flex flex-wrap gap-1.5">
        {recipe.ingredients.map((ing) => (
          <IngredientChip key={ing} label={ing} onSpecial={matched.has(ing)} />
        ))}
      </div>
      <div className="mt-3 flex justify-between border-t border-dashed border-stone-200 pt-3 text-[13px] text-stone-500 dark:border-stone-700 dark:text-stone-400">
        <span>Est. saving on specials</span>
        <b className="tabular-nums text-stone-900 dark:text-stone-100">{aud(analysis.saving)}</b>
      </div>
    </div>
  );
}

function SpecialRow({ special }) {
  const storeClass = special.store === "coles" ? "bg-red-600" : "bg-emerald-600";
  const storeLabel = special.store === "coles" ? "Coles" : "Woolies";
  return (
    <div className="flex items-center gap-3 border-b border-stone-100 py-3 last:border-b-0 dark:border-stone-800">
      <span className={`w-[74px] flex-none rounded-md px-1.5 py-1 text-center text-[9px] font-extrabold uppercase tracking-wide text-white ${storeClass}`}>
        {storeLabel}
      </span>
      <div className="flex-1">
        <div className="text-[13px] font-semibold text-stone-800 dark:text-stone-200">{special.name}</div>
        <div className="text-[11px] text-stone-400 dark:text-stone-500">{special.category}</div>
      </div>
      <div className="flex-none text-right">
        <div className="text-sm font-extrabold tabular-nums text-stone-900 dark:text-stone-100">{aud(special.now)}</div>
        <div className="text-[11px] tabular-nums text-stone-400 line-through dark:text-stone-500">{aud(special.was)}</div>
      </div>
    </div>
  );
}

function RecipeRow({ recipe, onDelete, onPlan }) {
  const { analysis } = recipe;
  const matched = new Set(analysis.matchedIngredients);
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 dark:border-stone-700 dark:bg-stone-950/40">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-extrabold tracking-tight text-stone-900 dark:text-stone-100">{recipe.name}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${
              analysis.isMatch
                ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                : "bg-stone-200 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
            }`}
          >
            {analysis.count} on special
          </span>
          <KcalChip kcal={recipe.kcalPerServe} />
          <button
            onClick={() => onDelete(recipe.id)}
            className="text-xs text-stone-400 hover:text-red-500"
            aria-label={`Delete ${recipe.name}`}
          >
            Remove
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {recipe.ingredients.map((ing) => (
          <IngredientChip key={ing} label={ing} onSpecial={matched.has(ing)} small />
        ))}
      </div>
      <div className="mt-2.5">
        <select
          value=""
          onChange={(e) => e.target.value && onPlan(recipe.id, e.target.value)}
          aria-label={`Add ${recipe.name} to a day`}
          className="cursor-pointer rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs font-semibold text-stone-700 outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
        >
          <option value="">＋ Add to plan…</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
      <ChefTips recipeId={recipe.id} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Weekly meal planner
 * ------------------------------------------------------------------------- */
function MealPlanner({ plan, onRemove }) {
  const todayIdx = (new Date().getDay() + 6) % 7; // Mon = 0

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {DAYS.map((day, di) => {
        const meals = plan[day] ?? [];
        const dayKcal = meals.reduce((s, m) => s + m.kcalPerServe, 0);
        const isToday = di === todayIdx;
        return (
          <div
            key={day}
            className={`flex min-h-[108px] flex-col gap-1.5 rounded-xl border bg-white p-2 dark:bg-stone-900 ${
              isToday
                ? "border-amber-400 ring-1 ring-amber-300 dark:border-amber-500/60 dark:ring-amber-500/30"
                : "border-stone-200 dark:border-stone-700"
            }`}
          >
            <div className={`flex items-center justify-between text-[10px] font-extrabold uppercase tracking-widest ${
              isToday ? "text-amber-600 dark:text-amber-400" : "text-stone-400"
            }`}>
              {day}
              {isToday && <span>·today</span>}
            </div>
            {meals.map((meal, mi) => (
              <div key={`${meal.id}-${mi}`} className="rounded-lg border border-stone-100 bg-stone-100 px-2 py-1 dark:border-stone-800 dark:bg-stone-800">
                <div className="flex items-start justify-between gap-1">
                  <span className="text-[11px] font-semibold leading-tight text-stone-800 dark:text-stone-200">{meal.name}</span>
                  <button
                    onClick={() => onRemove(day, mi)}
                    className="flex-none text-stone-400 hover:text-red-500"
                    aria-label={`Remove ${meal.name} from ${day}`}
                  >
                    ×
                  </button>
                </div>
                <div className="text-[10px] font-extrabold tabular-nums text-orange-700 dark:text-orange-400">
                  ~{meal.kcalPerServe} kcal
                </div>
              </div>
            ))}
            {dayKcal > 0 && (
              <div className="mt-auto border-t border-dashed border-stone-100 pt-1 text-right text-[10px] font-bold text-stone-400 dark:border-stone-800">
                ~<b className="tabular-nums text-orange-700 dark:text-orange-400">{dayKcal}</b> kcal
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Recipe manager (form + draft ingredient chips)
 * ------------------------------------------------------------------------- */
function RecipeManager({ onSave, saving }) {
  const [name, setName] = useState("");
  const [ingredientInput, setIngredientInput] = useState("");
  const [draft, setDraft] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Autocomplete from the recipe library — lets the user pick a dish that's
  // already been cooked before instead of retyping name + ingredients, and
  // guarantees an exact match against its saved tips (no AI call needed).
  useEffect(() => {
    const query = name.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setSuggestions(await api(`/dishes/suggest?q=${encodeURIComponent(query)}`));
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [name]);

  const pickSuggestion = (s) => {
    setName(s.name);
    setDraft(s.ingredients);
    setShowSuggestions(false);
  };

  const addIngredients = () => {
    const parts = ingredientInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) setDraft((d) => [...d, ...parts]);
    setIngredientInput("");
  };

  const save = async () => {
    if (!name.trim() || draft.length === 0) return;
    await onSave({ name: name.trim(), ingredients: draft });
    setName("");
    setDraft([]);
    setSuggestions([]);
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-700 dark:bg-stone-900">
      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Recipe name
      </label>
      <div className="relative mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="e.g. Tuna pasta bake"
          autoComplete="off"
          className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
        />
        {showSuggestions && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-900">
            {suggestions.map((s) => (
              <li key={s.name}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickSuggestion(s)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-amber-50 dark:hover:bg-stone-800"
                >
                  <span className="font-semibold text-stone-800 dark:text-stone-200">{s.name}</span>
                  <span className="flex-none text-[11px] text-stone-400">{s.ingredients.length} ingredients</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Ingredients
      </label>
      <div className="flex gap-2">
        <input
          value={ingredientInput}
          onChange={(e) => setIngredientInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addIngredients();
            }
          }}
          placeholder="Type an ingredient, press Enter"
          className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm text-stone-900 outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
        />
        <button
          onClick={addIngredients}
          className="flex-none rounded-lg border border-stone-200 bg-stone-100 px-4 text-sm font-bold text-stone-800 hover:bg-stone-200 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
        >
          Add
        </button>
      </div>

      {draft.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {draft.map((d, i) => (
            <span
              key={`${d}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-100 py-1 pl-2.5 pr-1.5 text-xs dark:border-stone-700 dark:bg-stone-800"
            >
              {d}
              <button
                onClick={() => setDraft((arr) => arr.filter((_, j) => j !== i))}
                className="text-stone-400 hover:text-red-500"
                aria-label={`Remove ${d}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="mt-4 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-bold text-amber-950 hover:brightness-105 disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save recipe"}
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * App shell
 * ------------------------------------------------------------------------- */
export default function HalfPriceHero() {
  const [specials, setSpecials] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [planData, setPlanData] = useState({ plan: {}, weekKcal: 0 });
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const refreshPlan = useCallback(async () => {
    setPlanData(await api("/plan"));
  }, []);

  const loadAll = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const [sp, rc, pl] = await Promise.all([api("/specials"), api("/recipes"), api("/plan")]);
      setSpecials(sp);
      setRecipes(rc);
      setPlanData(pl);
      setStatus("ready");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const fail = (err) => setError(err.message);

  const addRecipe = async (payload) => {
    setSaving(true);
    try {
      const created = await api("/recipes", { method: "POST", body: JSON.stringify(payload) });
      setRecipes((r) => [created, ...r]);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteRecipe = async (id) => {
    try {
      await api(`/recipes/${id}`, { method: "DELETE" });
      setRecipes((r) => r.filter((x) => x.id !== id));
      await refreshPlan(); // server also removes the recipe from the plan
    } catch (err) {
      fail(err);
    }
  };

  const planRecipe = async (recipeId, day) => {
    try {
      await api("/plan", { method: "POST", body: JSON.stringify({ day, recipeId }) });
      await refreshPlan();
    } catch (err) {
      fail(err);
    }
  };

  const unplanRecipe = async (day, index) => {
    try {
      await api(`/plan/${day}/${index}`, { method: "DELETE" });
      await refreshPlan();
    } catch (err) {
      fail(err);
    }
  };

  const matches = useMemo(
    () => recipes.filter((r) => r.analysis.isMatch).sort((a, b) => b.analysis.count - a.analysis.count),
    [recipes]
  );
  const totalSaving = matches.reduce((sum, r) => sum + r.analysis.saving, 0);
  const plannedMeals = DAYS.reduce((sum, d) => sum + (planData.plan[d]?.length ?? 0), 0);

  const weekLabel = useMemo(() => {
    const opts = { day: "numeric", month: "short" };
    const start = new Date();
    const end = new Date(start.getTime() + 6 * 864e5);
    return `${start.toLocaleDateString("en-AU", opts)} – ${end.toLocaleDateString("en-AU", opts)}`;
  }, []);

  if (status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 text-stone-500 dark:bg-stone-950 dark:text-stone-400">
        <p className="animate-pulse text-sm font-semibold">Loading this week's specials…</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50 dark:bg-stone-950">
        <div className="max-w-sm rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm dark:border-red-900 dark:bg-stone-900">
          <p className="mb-1 text-sm font-bold text-stone-900 dark:text-stone-100">Can't reach the API</p>
          <p className="mb-4 text-[13px] text-stone-500 dark:text-stone-400">
            {error} — is the server running on port 3001?
          </p>
          <button
            onClick={loadAll}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-amber-950 hover:brightness-105"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 dark:bg-stone-950 dark:text-stone-100">
      <div className="mx-auto max-w-5xl px-5 pb-20 pt-7">
        {/* Header */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-5">
          <div className="flex items-center gap-3">
            <div className="grid h-13 w-13 -rotate-6 place-items-center rounded-xl bg-amber-500 p-2 text-center leading-none text-amber-950 shadow-lg shadow-amber-500/40">
              <div>
                <div className="text-xl font-extrabold">½</div>
                <div className="text-[8px] font-bold tracking-widest">PRICE</div>
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight">Half Price Hero</h1>
              <p className="text-[13px] text-stone-500 dark:text-stone-400">
                This week's 50%-off specials, matched to your recipes.
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-stone-500 dark:text-stone-400">
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Catalogue week</div>
            <div className="text-sm font-bold text-stone-900 dark:text-stone-100">{weekLabel}</div>
            <div>Coles &amp; Woolworths</div>
          </div>
        </header>

        {/* Non-fatal action errors */}
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
            <button onClick={() => setError(null)} aria-label="Dismiss" className="font-bold">×</button>
          </div>
        )}

        {/* Stat tiles */}
        <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="½-price specials" value={specials.length} tone="gold" />
          <StatTile label="Your recipes" value={recipes.length} />
          <StatTile label="Recipes worth cooking" value={matches.length} tone="good" />
          <StatTile label="Potential saving" value={aud(totalSaving).replace(".00", "")} />
        </div>

        {/* Matches — the hero */}
        <section className="mb-8">
          <div className="mb-3.5 flex items-baseline gap-2.5">
            <h2 className="text-lg font-extrabold tracking-tight">🔔 Cook this week</h2>
            <span className="text-xs font-semibold text-stone-400">
              Recipes with {MATCH_THRESHOLD}+ ingredients at half price
            </span>
          </div>
          {matches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white p-6 text-center text-[13px] text-stone-500 dark:border-stone-700 dark:bg-stone-900">
              No recipes hit {MATCH_THRESHOLD}+ half-price ingredients yet. Add a recipe that uses this week's specials
              and it'll pop up here.
            </div>
          ) : (
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map((recipe) => (
                <MatchCard key={recipe.id} recipe={recipe} />
              ))}
            </div>
          )}
        </section>

        {/* Weekly meal planner */}
        <section className="mb-8">
          <div className="mb-3.5 flex flex-wrap items-baseline gap-2.5">
            <h2 className="text-lg font-extrabold tracking-tight">📅 Meal planner</h2>
            <span className="text-xs font-semibold text-stone-400">
              {plannedMeals > 0
                ? `${plannedMeals} meal${plannedMeals === 1 ? "" : "s"} planned · ~${planData.weekKcal} kcal this week`
                : "Pick meals from your recipes below"}
            </span>
          </div>
          <MealPlanner plan={planData.plan} onRemove={unplanRecipe} />
        </section>

        {/* Two working columns */}
        <div className="grid items-start gap-6 md:grid-cols-2">
          <div>
            <div className="mb-3.5 flex items-baseline gap-2.5">
              <h2 className="text-lg font-extrabold tracking-tight">Recipe manager</h2>
              <span className="text-xs font-semibold text-stone-400">
                {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"}
              </span>
            </div>
            <RecipeManager onSave={addRecipe} saving={saving} />
            <div className="mt-3.5 flex flex-col gap-2.5">
              {recipes.map((recipe) => (
                <RecipeRow key={recipe.id} recipe={recipe} onDelete={deleteRecipe} onPlan={planRecipe} />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3.5 flex items-baseline gap-2.5">
              <h2 className="text-lg font-extrabold tracking-tight">This week's ½-price specials</h2>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white px-4 py-1.5 shadow-sm dark:border-stone-700 dark:bg-stone-900">
              {specials.map((s) => (
                <SpecialRow key={s.id} special={s} />
              ))}
            </div>
          </div>
        </div>

        <footer className="mt-10 text-center text-[11.5px] text-stone-400">
          Prototype · mock catalogue data · calories are rough per-serve estimates ·{" "}
          <b className="text-stone-500">Half Price Hero</b>
        </footer>
      </div>
    </div>
  );
}
