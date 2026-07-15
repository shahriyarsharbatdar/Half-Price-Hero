import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";

/**
 * Extracts half-price / specials items from a Coles or Woolworths catalogue
 * PDF using Claude's native PDF support — no OCR pipeline of our own, Claude
 * reads the page images directly.
 *
 * Real catalogues run 50-100 pages and 25-30MB (confirmed against actual
 * Coles/Woolworths exports — Coles: 51 pages/30.4MB, Woolworths: 93
 * pages/24.5MB) — big enough to risk Claude's 32MB/request limit as a single
 * request (base64 inflates ~33%) and to want splitting up for extraction
 * reliability regardless. Two retailers, two very different layouts:
 * Woolworths' export alternates a content page then a near-blank
 * continuation page (roughly half the pages are filler); Coles' is densely
 * packed with no blank pages at all. Rather than special-case either shape,
 * this just splits the PDF into small fixed-size page chunks (pdf-lib, pure
 * JS — no native rendering/OCR dependency) and extracts each chunk
 * independently, in parallel, then merges the results. A chunk that's
 * mostly/entirely blank just legitimately returns few or no items.
 */

const MODEL = "claude-opus-4-8";
const PAGES_PER_CHUNK = 15; // small enough that even Coles' densest chunk stays well under the request-size and output-token budgets
const CHUNK_CONCURRENCY = 5; // a full catalogue is 15-20+ chunks — sequential would take many minutes

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

const SYSTEM = `You are extracting discounted grocery products from a few consecutive pages of a larger Australian supermarket catalogue PDF.

You're seeing a SLICE of the catalogue, not the whole document. Some slices
are entirely blank/legal-text continuation pages — if so, just return an
empty items list, that's expected and correct.

List every product shown with a clear discount — a "was" price and a lower
"now"/special price (however it's badged: "½ Price", "Save $X", a
struck-through price next to a new one, "Better than ½ Price", etc).

Rules:
- Only include items where BOTH the original and discounted price are visible
  or unambiguously stated on the page. Skip anything where you'd have to guess
  a price, or where a price seems to continue onto a page you can't see.
- "was" and "now" are plain numbers in AUD (e.g. 7.5, not "$7.50").
- Keep the product name as printed, including pack size/weight — that detail
  is what lets the app match it against a recipe's ingredients.
- Infer "category" from the page section or product type; keep it short and
  generic (Pantry, Dairy, Produce, Frozen, Meat, Bakery, Confectionery, ...).
- Don't invent items that aren't on the page, and don't skip real ones because
  there are many — a single page can have a dozen discounted items; list all.`;

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

async function splitIntoChunks(pdfBuffer) {
  const src = await PDFDocument.load(pdfBuffer);
  const totalPages = src.getPageCount();
  const chunks = [];
  for (let start = 0; start < totalPages; start += PAGES_PER_CHUNK) {
    const end = Math.min(start + PAGES_PER_CHUNK, totalPages);
    const chunkDoc = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await chunkDoc.copyPages(src, indices);
    pages.forEach((p) => chunkDoc.addPage(p));
    chunks.push(Buffer.from(await chunkDoc.save()));
  }
  return chunks;
}

async function extractFromChunk(chunkBuffer) {
  // Streaming, not .create() — the SDK refuses a plain (non-streaming) request at this
  // max_tokens as a timeout safeguard; .get_final_message() still gives back one
  // accumulated response, same as a non-streaming call would.
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 24000, // a single dense Coles-style page can list 10+ items; a chunk of 15 needs real headroom
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low", // reading clearly-printed price tags off a small page slice — not a deep-reasoning task
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
              data: chunkBuffer.toString("base64"),
            },
          },
          { type: "text", text: "Extract every discounted product from these catalogue pages." },
        ],
      },
    ],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") return [];
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  const data = JSON.parse(text); // guaranteed valid JSON by output_config.format
  return data.items.filter((item) => item.was > item.now); // guard against a stray non-markdown row
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * @param {Buffer} pdfBuffer
 * @param {(completed: number, total: number) => void} [onProgress] called after each chunk finishes
 * @returns {Promise<{name: string, category: string, was: number, now: number}[]>}
 */
export async function extractSpecialsFromCatalogue(pdfBuffer, onProgress) {
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY is not configured — catalogue extraction requires the Claude API");
  }

  const chunks = await splitIntoChunks(pdfBuffer);
  let completed = 0;

  const results = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, async (chunk, i) => {
    try {
      return await extractFromChunk(chunk);
    } catch (err) {
      // One bad chunk (a transient API error, a truly unreadable page) shouldn't
      // sink the whole catalogue — log it and keep the rest of the results.
      console.error(`catalogue chunk ${i + 1}/${chunks.length} failed: ${err.message}`);
      return [];
    } finally {
      completed++;
      onProgress?.(completed, chunks.length);
    }
  });

  return results.flat();
}
