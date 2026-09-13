import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIResponsesModelProvider, type ModelGenerationRequest } from "../src/index.ts";

const request = (): ModelGenerationRequest => ({ instructions: "Explain only facts.", promptVersion: "test@1", outputSchemaId: "nerve.agent-narrative@1", input: { facts: [{ factId: "fact-1", label: "Low stock", value: 100, evidenceIds: ["evidence-1"] }], evidence: [{ evidenceId: "evidence-1", label: "Tank record" }] }, maxOutputTokens: 200, safetyIdentifier: "safe-hash", signal: new AbortController().signal });

test("OpenAI Responses provider requests strict structured output and returns measured usage", async () => {
  let sent: Record<string, unknown> | undefined;
  const provider = new OpenAIResponsesModelProvider({ apiKey: "test-key-with-more-than-20-characters", model: "configured-test-model", fetch: async (_url, init) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ headline: "Stock review", summary: "One issue", claims: [{ claimId: "claim-1", text: "Low stock", factIds: ["fact-1"], evidenceIds: ["evidence-1"] }] }) }] }], usage: { input_tokens: 40, output_tokens: 20 } }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const result = await provider.generate(request());
  assert.equal(result.provider, "openai"); assert.equal(result.model, "configured-test-model"); assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 20 });
  assert.deepEqual(result.output, { headline: "Stock review", summary: "One issue", claims: [{ claimId: "claim-1", text: "Low stock", factIds: ["fact-1"], evidenceIds: ["evidence-1"] }] });
  const format = ((sent?.text as Record<string, unknown>).format as Record<string, unknown>);
  assert.equal(format.type, "json_schema"); assert.equal(format.strict, true); assert.equal(sent?.safety_identifier, "safe-hash");
});

test("OpenAI Responses provider fails closed on provider errors", async () => {
  const provider = new OpenAIResponsesModelProvider({ apiKey: "test-key-with-more-than-20-characters", model: "configured-test-model", fetch: async () => new Response("unavailable", { status: 503 }) });
  await assert.rejects(() => provider.generate(request()), /returned 503/);
});
