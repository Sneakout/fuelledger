import { randomUUID } from "node:crypto";
import type { ExecutionContext, JsonObject, SignedEnvelope, ToolRequest, ToolResult } from "./contracts.ts";
import { signEnvelope, type SigningKey } from "./signing.ts";
import { toolResultSchema } from "./validation.ts";

export type NerveTransport = (envelope: SignedEnvelope<ToolRequest>) => Promise<unknown>;

export class NerveClient {
  private readonly key: SigningKey;
  private readonly transport: NerveTransport;
  constructor(key: SigningKey, transport: NerveTransport) { this.key = key; this.transport = transport; }

  async call<I extends JsonObject, O extends JsonObject>(input: {
    context: ExecutionContext; toolId: string; payload: I; idempotencyKey?: string; approvalId?: string;
  }): Promise<ToolResult<O>> {
    const request: ToolRequest<I> = {
      requestId: randomUUID(), toolId: input.toolId, contractVersion: input.context.contractVersion,
      context: input.context, input: input.payload,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    };
    const envelope = signEnvelope(request, this.key, { nonce: randomUUID() });
    return toolResultSchema(await this.transport(envelope)) as ToolResult<O>;
  }
}
