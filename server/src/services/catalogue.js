import Anthropic from "@anthropic-ai/sdk";

/**
 * Extracts half-price / specials items from a Coles or Woolworths catalogue
 * PDF using Claude's native PDF support — no OCR pipeline of our own, Claude
 * reads the page images directly.
 *
 * This replaces the (blocked) scraper as the source of specials data: the
 * user downloads the weekly catalogue PDF from the retailer's site and
 * uploads it via /admin; this turns that PDF into the same
 * { name, category, was, now } shape the rest of the app already expects.
 */

const MODEL = "claude-opus-4-8";

const CATALOGUE_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Product name exactly as printed, including brand and pack size/weight if shown",
          },
          category: {
            type: "string",
            description: "A short grocery category inferred from the page/section, e.g. Pantry, Dairy, Produce, Frozen, Confectionery, Meat, Bakery",
          },
          was: { type: "number", description: "Original price in AUD before the discount, as a plain number (no $ sign)" },
          now: { type: "number", description: "The discounted/special price in AUD, as a plain number" },
        },
        required: ["name", "category", "was", "now"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const SYSTEM = `You are extracting discounted grocery products from an Australian supermarket catalogue PDF.

Go through every page and list every product shown with a clear discount — a
"was" price and a lower "now"/special price (however it's badged: "½ Price",
"Save $X", "Special", a struck-through price next to a new one, etc).

Rules:
- Only include items where BOTH the original and discounted price are visible
  or unambiguously stated on the page. Skip anything where you'd have to guess
  a price.
- "was" and "now" are plain numbers in AUD (e.g. 7.5, not "$7.50").
- Keep the product name as printed, including pack size/weight — that detail
  is what lets the app match it against a recipe's ingredients.
- Infer "category" from the page section or product type; keep it short and
  generic (Pantry, Dairy, Produce, Frozen, Meat, Bakery, Confectionery, ...).
- Don't invent items that aren't on the page, and don't skip real ones because
  there are many — a catalogue can have 100+ discounted items; list all of them.`;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

/**
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{name: string, category: string, was: number, now: number}[]>}
 */
export async function extractSpecialsFromCatalogue(pdfBuffer) {
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY is not configured — catalogue extraction requires the Claude API");
  }

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000, // catalogues can list 100+ items; tips-sized limits would truncate
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium", // reading a scanned/visual layout accurately benefits from more than "low"
      format: { type: "json_schema", schema: CATALOGUE_SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBuffer.toString("base64"),
            },
          },
          { type: "text", text: "Extract every discounted product from this catalogue." },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined to process this file");
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const data = JSON.parse(text); // guaranteed valid JSON by output_config.format
  return data.items.filter((item) => item.was > item.now); // guard against a stray non-markdown row
}
