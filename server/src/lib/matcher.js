/** Keyword matching between recipe ingredients and catalogue specials. */

const MATCH_THRESHOLD = 2;
const STOPWORDS = new Set(["the", "and", "with", "of", "in"]);

/**
 * Light English stemming so "tomato" (e.g. a machine translation, which
 * defaults to singular) still matches catalogue text like "Tomatoes".
 * Deliberately conservative — only strips a plain trailing "s"/"es" — since
 * over-stemming would start creating false matches between unrelated words.
 */
function stem(word) {
  if (word.endsWith("ies") && word.length > 5) return word.slice(0, -3) + "y"; // berries -> berry
  if (word.endsWith("es") && word.length > 5) return word.slice(0, -2); // tomatoes -> tomato
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1); // eggs -> egg, onions -> onion
  return word;
}

function keywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+[a-z]*$/.test(w))
    .map(stem);
}

/**
 * Best-overlap match rather than first-match — two specials can share a
 * generic word (e.g. both "Pasta Sauce" and "Soy Sauce" contain "sauce"), so
 * picking the first hit can attribute an ingredient to the wrong product.
 * Scoring by shared keyword count and taking the highest picks "Soy Sauce"
 * for a "soy sauce" ingredient instead of whichever "sauce" appears first.
 */
export function findSpecialForIngredient(ingredient, specials) {
  const ingWords = new Set(keywords(ingredient));
  if (ingWords.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const special of specials) {
    const score = keywords(special.name).filter((w) => ingWords.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      best = special;
    }
  }
  return best;
}

export function analyseRecipe(recipe, specials) {
  // Match against the English translation so ingredients typed in any
  // language still line up with the (English-only) specials catalogue —
  // the ingredient shown to the user is always the original text.
  const englishIngredients = recipe.ingredientsEn ?? recipe.ingredients;
  const onSpecial = recipe.ingredients
    .map((ingredient, i) => ({
      ingredient,
      special: findSpecialForIngredient(englishIngredients[i] ?? ingredient, specials),
    }))
    .filter((x) => x.special);

  const saving = onSpecial.reduce((sum, x) => sum + (x.special.was - x.special.now), 0);

  return {
    onSpecial,
    matchedIngredients: onSpecial.map((x) => x.ingredient),
    count: onSpecial.length,
    saving: Math.round(saving * 100) / 100,
    isMatch: onSpecial.length >= MATCH_THRESHOLD,
  };
}
