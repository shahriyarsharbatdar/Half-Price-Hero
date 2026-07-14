/**
 * Rough kcal-per-serve estimates from a keyword table.
 * Phase 2: swap for a nutrition API (FoodData Central / Edamam) —
 * keep this as the offline fallback.
 */
const CALORIE_TABLE = [
  ["spaghetti", 220], ["pasta sauce", 90], ["pasta", 200], ["noodle", 220],
  ["rice", 210], ["tuna", 130], ["salmon", 210], ["chicken", 200], ["beef", 280],
  ["cheese", 120], ["feta", 100], ["egg", 80], ["oil", 120], ["butter", 100],
  ["soy", 10], ["tomato", 30], ["chocolate", 250], ["potato", 140], ["gravy", 60],
  ["peas", 60], ["onion", 25], ["garlic", 10], ["bread", 180], ["milk", 100],
  ["cream", 150], ["flour", 110], ["sugar", 50],
];

const DEFAULT_KCAL = 90;

export function estimateCalories(recipe) {
  return recipe.ingredients.reduce((sum, ing) => {
    const low = ing.toLowerCase();
    const hit = CALORIE_TABLE.find(([kw]) => low.includes(kw));
    return sum + (hit ? hit[1] : DEFAULT_KCAL);
  }, 0);
}
