import type { AgentNarrative, ModelGenerationRequest, ModelGenerationResult, ModelProvider } from "./runtime-contracts.ts";

export class StaticModelProvider implements ModelProvider {
  constructor(outputFactory: (request: ModelGenerationRequest) => unknown, options: { provider?: string; model?: string; usage?: { inputTokens: number; outputTokens: number } } = {}) {
    this.outputFactory = outputFactory; this.provider = options.provider ?? "mock"; this.model = options.model ?? "static-model"; this.usage = options.usage ?? { inputTokens: 10, outputTokens: 10 };
  }
  private readonly outputFactory: (request: ModelGenerationRequest) => unknown;
  private readonly provider: string;
  private readonly model: string;
  private readonly usage: { inputTokens: number; outputTokens: number };
  async generate(request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    if (request.signal.aborted) throw request.signal.reason;
    return { output: this.outputFactory(request), provider: this.provider, model: this.model, usage: this.usage };
  }
}

type Fetch = typeof globalThis.fetch;
export type OpenAIResponsesModelProviderOptions = { apiKey: string; model: string; baseUrl?: string; fetch?: Fetch };

/** Structured-output provider. Runtime grounding and numeric validation remain authoritative. */
export class OpenAIResponsesModelProvider implements ModelProvider {
  private readonly apiKey: string; private readonly model: string; private readonly baseUrl: string; private readonly fetch: Fetch;
  constructor(options: OpenAIResponsesModelProviderOptions) {
    if (options.apiKey.length < 20) throw new Error("A valid OpenAI API key is required.");
    if (!options.model.trim()) throw new Error("An OpenAI model is required.");
    this.apiKey = options.apiKey; this.model = options.model; this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, ""); this.fetch = options.fetch ?? globalThis.fetch;
  }
  async generate(request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const response = await this.fetch(`${this.baseUrl}/responses`, {
      method: "POST", signal: request.signal,
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model, max_output_tokens: request.maxOutputTokens, safety_identifier: request.safetyIdentifier,
        input: [{ role: "system", content: `${request.instructions}\nReturn concise owner-facing explanations. Use only supplied facts and cite every claim with exact factIds and evidenceIds.` }, { role: "user", content: JSON.stringify(request.input) }],
        text: { format: { type: "json_schema", name: "fuelnerve_agent_narrative", strict: true, schema: narrativeJsonSchema } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI Responses API returned ${response.status}.`);
    const payload = await response.json() as Record<string, unknown>;
    const outputText = typeof payload.output_text === "string" ? payload.output_text : extractOutputText(payload.output);
    if (!outputText) throw new Error("OpenAI Responses API returned no structured output.");
    const usage = payload.usage && typeof payload.usage === "object" ? payload.usage as Record<string, unknown> : {};
    return { output: JSON.parse(outputText), provider: "openai", model: this.model, usage: { inputTokens: finiteNumber(usage.input_tokens), outputTokens: finiteNumber(usage.output_tokens) } };
  }
}

const narrativeJsonSchema = {
  type: "object", additionalProperties: false, required: ["headline", "summary", "claims"],
  properties: {
    headline: { type: "string" }, summary: { type: "string" },
    claims: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["claimId", "text", "factIds", "evidenceIds"],
        properties: {
          claimId: { type: "string" }, text: { type: "string" },
          factIds: { type: "array", items: { type: "string" }, minItems: 1 },
          evidenceIds: { type: "array", items: { type: "string" }, minItems: 1 },
        },
      },
    },
  },
} as const;
function extractOutputText(output: unknown) { if (!Array.isArray(output)) return ""; for (const item of output) { if (!item || typeof item !== "object") continue; const content = (item as Record<string, unknown>).content; if (!Array.isArray(content)) continue; for (const part of content) if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") return (part as Record<string, unknown>).text as string; } return ""; }
function finiteNumber(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

export function validateGrounding(narrative: AgentNarrative, factIds: Set<string>, evidenceIds: Set<string>): void {
  for (const claim of narrative.claims) {
    if (!claim.factIds.length || !claim.evidenceIds.length) throw new Error(`Claim ${claim.claimId} is not grounded.`);
    if (claim.factIds.some(id => !factIds.has(id))) throw new Error(`Claim ${claim.claimId} references an unknown fact.`);
    if (claim.evidenceIds.some(id => !evidenceIds.has(id))) throw new Error(`Claim ${claim.claimId} references unknown evidence.`);
  }
}

export function validateNarrativeNumbers(narrative: AgentNarrative, suppliedFacts: unknown): void {
  const allowed = new Set(numberTokens(JSON.stringify(suppliedFacts)));
  const introduced = numberTokens([narrative.headline, narrative.summary, ...narrative.claims.map(claim => claim.text)].join(" ")).filter(token => !allowed.has(token));
  if (introduced.length) throw new Error("Model narrative introduced a number that was not supplied by the application.");
}

function numberTokens(value: string): string[] {
  return [...value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map(match => match[0]!.replaceAll(",", "").replace(/^-0$/, "0"));
}
