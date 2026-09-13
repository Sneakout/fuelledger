import type { EvidenceReference, JsonObject, SignedEnvelope, ToolRequest } from "./contracts.ts";
import { CONTRACT_VERSION } from "./contracts.ts";
import { enforcePermittedLocations, scopedQuerySchema } from "./capabilities.ts";
import { ToolRegistry } from "./registry.ts";
import { InMemoryNonceStore, verifyEnvelope, type SigningKey } from "./signing.ts";
import { jsonObject, object } from "./validation.ts";

export const mockSigningKey: SigningKey = { keyId: "mock-app-key-1", secret: "development-secret-at-least-thirty-two-characters" };

export function createMockContext(overrides: Partial<ToolRequest["context"]> = {}): ToolRequest["context"] {
  const now = new Date();
  return {
    contractVersion: CONTRACT_VERSION, applicationId: "mock-business-app", environment: "development",
    tenantId: "tenant-alpha", actorId: "owner-1", roles: ["OWNER"], permittedLocationIds: ["location-1"],
    grantedScopes: ["inventory:read", "evidence:read"], correlationId: "correlation-1",
    issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), ...overrides,
  };
}

export function createMockApplication() {
  const registry = new ToolRegistry({ applicationId: "mock-business-app", supportedVersions: [CONTRACT_VERSION] });
  registry.register({
    definition: {
      toolId: "inventory.position.read", contractVersion: CONTRACT_VERSION, description: "Read application-calculated inventory position.",
      actionClass: "OBSERVE", riskLevel: "R0", requiredScopes: ["inventory:read"], requiresApproval: false,
      idempotent: false, timeoutMs: 5_000, inputSchemaId: "nerve.scoped-query@1", outputSchemaId: "mock.inventory-position@1",
    },
    validateInput: scopedQuerySchema,
    validateOutput: value => {
      const v = object(value, "result.output");
      if (!Array.isArray(v.items)) throw new Error("result.output.items must be an array");
      return v as JsonObject;
    },
    handler: async request => {
      const input = scopedQuerySchema(request.input);
      enforcePermittedLocations(input.locationIds, request.context.permittedLocationIds);
      const evidence: EvidenceReference[] = [{
        evidenceId: "evidence-stock-1", evidenceType: "INVENTORY_SNAPSHOT", applicationId: request.context.applicationId,
        tenantId: request.context.tenantId, resourceId: "inventory-item-1", label: "Inventory snapshot", observedAt: input.asOf,
        resolverPath: "/inventory/items/inventory-item-1",
      }];
      return { output: { items: [{ resourceId: "inventory-item-1", quantity: 1250, unit: "LITRE", status: "HEALTHY", evidenceIds: ["evidence-stock-1"] }] }, evidence };
    },
  });

  const nonceStore = new InMemoryNonceStore();
  const receive = async (envelope: SignedEnvelope<ToolRequest>) => {
    const request = await verifyEnvelope(envelope, keyId => keyId === mockSigningKey.keyId ? mockSigningKey.secret : undefined, nonceStore);
    return registry.execute(request);
  };
  return { registry, receive };
}

export const invalidOutputSchema = jsonObject;
