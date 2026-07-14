/**
 * Identity key for a dish in the recipe library: same name + same English
 * ingredient set = same dish, regardless of which recipe id it's attached to
 * or what language the ingredients were originally typed in.
 */
export function libraryKey(name, ingredientsEn) {
  const sortedIngredients = [...ingredientsEn].map((i) => i.toLowerCase().trim()).sort();
  return `${name.trim().toLowerCase()}|${sortedIngredients.join(",")}`;
}
