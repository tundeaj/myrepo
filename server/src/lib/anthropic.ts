import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { env } from "./env.js";
import { ApiError } from "./errors.js";

// Every Claude call in this codebase goes through here. Two reasons:
// the API key must never leave the server (no client-side calls anywhere), and
// a provider error must never reach the caller verbatim — it's logged against a
// correlation ID and returned as plain English.

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new ApiError(503, "AI features aren't configured yet. Add an Anthropic API key in Settings → Integrations.");
  }
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export function isAiConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** Pulls the plain text out of a response, ignoring any non-text blocks. */
function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

interface CallOptions {
  system: string;
  user: string;
  maxTokens?: number;
  /** Short marketing copy doesn't benefit from reasoning; analysis does. */
  think?: boolean;
  effort?: "low" | "medium" | "high";
  /** When set, the model is constrained to this JSON Schema. */
  jsonSchema?: Record<string, unknown>;
}

export interface CallResult {
  text: string;
  parsed?: unknown;
  stopReason: string | null;
}

/**
 * One entry point for every Claude call. Errors are logged with a correlation
 * ID and re-thrown as ApiError, so a provider outage reads as a sentence rather
 * than a stack trace with a request ID in it.
 */
export async function callClaude(opts: CallOptions): Promise<CallResult> {
  const correlationId = randomUUID();
  const anthropic = getClient();

  try {
    const message = await anthropic.messages.create({
      model: env.ANTHROPIC_MODEL,
      max_tokens: opts.maxTokens ?? 1000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      // Adaptive thinking for judgment work; off for short generation, where it
      // only adds latency and cost to a 200-character answer.
      thinking: opts.think ? { type: "adaptive" } : { type: "disabled" },
      output_config: {
        effort: opts.effort ?? (opts.think ? "medium" : "low"),
        ...(opts.jsonSchema
          ? { format: { type: "json_schema" as const, schema: opts.jsonSchema } }
          : {}),
      },
    });

    // Safety classifiers can decline a request with a 200 and an empty body —
    // check before reading content, or this reads as a mysterious blank result.
    if (message.stop_reason === "refusal") {
      console.warn(`[${correlationId}] Claude declined the request`, message.stop_details ?? {});
      throw new ApiError(422, "The AI assistant couldn't help with this request. Try rephrasing it.");
    }

    const text = textOf(message);
    if (!text) {
      console.warn(`[${correlationId}] Claude returned no text; stop_reason=${message.stop_reason}`);
      throw new ApiError(502, "The AI assistant returned an empty response. Please try again.");
    }

    let parsed: unknown;
    if (opts.jsonSchema) {
      try {
        parsed = JSON.parse(text);
      } catch {
        console.warn(`[${correlationId}] Structured output was not valid JSON`);
        throw new ApiError(502, "The AI assistant returned an unexpected format. Please try again.");
      }
    }

    return { text, parsed, stopReason: message.stop_reason };
  } catch (err) {
    if (err instanceof ApiError) throw err;

    // Map the SDK's typed errors to something a person can act on. The raw
    // provider message is logged, never returned.
    console.error(`[${correlationId}] Anthropic call failed:`, err);

    if (err instanceof Anthropic.AuthenticationError) {
      throw new ApiError(503, "The Anthropic API key is invalid. Check it in Settings → Integrations.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new ApiError(429, "The AI assistant is busy right now. Try again in a moment.");
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new ApiError(503, "Couldn't reach the AI assistant. Check the server's connection and try again.");
    }
    throw new ApiError(502, `The AI assistant is unavailable right now. Quote reference ${correlationId} if this keeps happening.`);
  }
}
