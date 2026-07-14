import Anthropic from "@anthropic-ai/sdk";
import { ruleBasedTips } from "../lib/tips-rules.js";
import { estimateCalories } from "../lib/calories.js";

/**
 * Chef's tips + a suggested cooking method via the Claude API, with structured
 * output so the response is guaranteed-parseable JSON. Falls back to the
 * rule-based engine (tips only, no method) when no API key is configured or
 * the call fails.
 *
 * This module always calls out (no caching here) — the caller (routes/tips.js)
 * checks the persistent recipe library first and only reaches this function
 * on a cache miss.
 */

const MODEL = "claude-opus-4-8";

const TIPS_SCHEMA = {
  type: "object",
  properties: {
    recipe_steps: {
      type: "array",
      items: { type: "string" },
      description:
        "4-8 concise numbered cooking steps from prep to plate, in order. Use only the given " +
        "ingredients plus common pantry staples (salt, pepper, oil, water) — do not introduce " +
        "other named ingredients.",
    },
    tips: {
      type: "array",
      items: { type: "string" },
      description: "3-4 practical cooking tips, each one sentence",
    },
    estimated_kcal_per_serve: {
      type: "integer",
      description: "Rough calories per serve for the whole dish",
    },
  },
  required: ["recipe_steps", "tips", "estimated_kcal_per_serve"],
  additionalProperties: false,
};

const SYSTEM = `You are a practical home-cooking coach for an Australian grocery-savings app.
Given a dish name and its ingredient list, produce:
1. A step-by-step cooking method — 4-8 concise numbered steps from prep to plate, using only
   the listed ingredients plus common pantry staples (salt, pepper, oil, water).
2. 3-4 short, concrete tips that make the dish tastier — technique, timing, order of operations.
   One sentence each, no fluff, no safety boilerplate.
3. An estimate of calories per serve for the dish as a whole.`;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

export async function tipsForRecipe(recipe) {
  let result;
  if (!client) {
    result = fallback(recipe, "no ANTHROPIC_API_KEY configured");
  } else {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048, // tips are deliberately short
        thinking: { type: "adaptive" },
        output_config: {
          effort: "low", // simple generation task — no deep reasoning needed
          format: { type: "json_schema", schema: TIPS_SCHEMA },
        },
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Dish: ${recipe.name}\nIngredients: ${recipe.ingredients.join(", ")}`,
          },
        ],
      });

      if (response.stop_reason === "refusal") {
        result = fallback(recipe, "model declined the request");
      } else {
        const text = response.content.find((b) => b.type === "text")?.text ?? "";
        const data = JSON.parse(text); // guaranteed valid JSON by output_config.format
        result = {
          source: "claude",
          recipeSteps: data.recipe_steps.slice(0, 8),
          tips: data.tips.slice(0, 4),
          kcalPerServe: data.estimated_kcal_per_serve,
        };
      }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        result = fallback(recipe, "invalid ANTHROPIC_API_KEY");
      } else if (err instanceof Anthropic.RateLimitError) {
        result = fallback(recipe, "rate limited — try again shortly");
      } else if (err instanceof Anthropic.APIError) {
        result = fallback(recipe, `Claude API error (${err.status ?? "network"})`);
      } else {
        result = fallback(recipe, err.message);
      }
    }
  }

  return result;
}

function fallback(recipe, reason) {
  return {
    source: "rules",
    reason,
    recipeSteps: [], // no offline method generator — UI hides this section when empty
    tips: ruleBasedTips(recipe),
    kcalPerServe: estimateCalories(recipe),
  };
}
