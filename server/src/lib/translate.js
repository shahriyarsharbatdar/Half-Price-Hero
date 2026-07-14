import translate from "google-translate-api-x";
import { getCachedTranslation, setCachedTranslation } from "../store.js";

/**
 * Translate ingredient text to English so it can be matched against the
 * (English-only) specials catalogue, regardless of what language the user
 * typed it in. Uses a free, unofficial Google Translate wrapper — no AI
 * model, no API key, no per-request billing.
 *
 * ASCII text is assumed to already be English and skips the network call
 * entirely (the common case). Non-ASCII text is translated once and cached
 * in the persistent store so the same phrase never round-trips twice.
 */

const isAscii = (text) => /^[\x00-\x7F]*$/.test(text);

export async function translateToEnglish(text) {
  const trimmed = text.trim();
  if (!trimmed || isAscii(trimmed)) return trimmed;

  const cached = getCachedTranslation(trimmed);
  if (cached) return cached;

  try {
    const result = await translate(trimmed, { to: "en" });
    const english = result.text.trim();
    setCachedTranslation(trimmed, english);
    return english;
  } catch {
    // Translation service unreachable — fall back to the original text.
    // Matching will simply miss for this ingredient until the service is back.
    return trimmed;
  }
}

export async function translateIngredients(ingredients) {
  return Promise.all(ingredients.map(translateToEnglish));
}
