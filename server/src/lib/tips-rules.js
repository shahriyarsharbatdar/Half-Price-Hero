/**
 * Rule-based chef's tips — the offline fallback when ANTHROPIC_API_KEY
 * is not configured or the API call fails. Mirrors the Phase 1 UI logic.
 */
const NAME_TIPS = [
  ["bake",       "Bake at 190 °C for ~25 min until the top is golden and bubbling."],
  ["fried rice", "Day-old fridge-cold rice fries far better — hot pan, and don't crowd it."],
  ["salad",      "Dress the salad just before serving so it stays crisp."],
  ["roast",      "Rest the roast 10–15 min under foil before carving — juicier every time."],
  ["soup",       "Blend half the soup for body and keep half chunky for texture."],
  ["curry",      "Bloom the spices in hot oil first — it wakes up the whole dish."],
  ["stir",       "Prep everything before the pan gets hot — stir-fries wait for no one."],
];

const INGREDIENT_TIPS = [
  ["tuna",      "Drain the tuna well and fold it through at the end so it stays moist."],
  ["rice",      "Rinse the rice until the water runs clear, then rest it 10 min off the heat."],
  ["spaghetti", "Cook pasta 2 min under packet time and finish it in the sauce — save a cup of pasta water."],
  ["pasta",     "Cook pasta 2 min under packet time and finish it in the sauce — save a cup of pasta water."],
  ["sauce",     "Simmer the sauce an extra 10 min with a pinch of sugar to round out the acidity."],
  ["cheese",    "Stir half the cheese through the mix and scatter half on top for a golden crust."],
  ["soy",       "Add soy sauce off the heat at the end so its aroma doesn't cook away."],
  ["egg",       "Scramble the eggs separately in a hot pan, then fold them back through."],
  ["oil",       "Keep a little olive oil to finish raw over the plate — that's where the flavour lives."],
  ["tomato",    "Salt the tomatoes 10 min ahead and drain them — it concentrates the flavour."],
  ["beef",      "Bring the beef to room temp and pat it dry before it hits the pan."],
  ["potato",    "Par-boil the potatoes and rough them up in the colander for crunchy edges."],
  ["peas",      "Frozen peas go straight in for the last 2 minutes only — no more."],
  ["feta",      "Crumble the feta over at the end; cooking it through kills its tang."],
];

const MAX_TIPS = 4;

export function ruleBasedTips(recipe) {
  const tips = [];
  const push = (t) => {
    if (!tips.includes(t) && tips.length < MAX_TIPS) tips.push(t);
  };
  const nameLow = recipe.name.toLowerCase();
  NAME_TIPS.forEach(([kw, tip]) => nameLow.includes(kw) && push(tip));
  recipe.ingredients.forEach((ing) => {
    const low = ing.toLowerCase();
    const hit = INGREDIENT_TIPS.find(([kw]) => low.includes(kw));
    if (hit) push(hit[1]);
  });
  return tips;
}
