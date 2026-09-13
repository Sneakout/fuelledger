import { AgentSdkError } from "./errors.ts";
import type { AgentNarrative } from "./runtime-contracts.ts";
import { object, string, stringArray, type Validator } from "./validation.ts";

export const agentNarrativeSchema: Validator<AgentNarrative> = (value, path = "narrative") => {
  const v = object(value, path);
  if (!Array.isArray(v.claims)) throw new AgentSdkError("STRUCTURED_OUTPUT_INVALID", `${path}.claims must be an array.`);
  return {
    headline: string(v.headline, `${path}.headline`), summary: string(v.summary, `${path}.summary`),
    claims: v.claims.map((item, index) => {
      const claim = object(item, `${path}.claims[${index}]`);
      return { claimId: string(claim.claimId, `${path}.claims[${index}].claimId`), text: string(claim.text, `${path}.claims[${index}].text`), factIds: stringArray(claim.factIds, `${path}.claims[${index}].factIds`), evidenceIds: stringArray(claim.evidenceIds, `${path}.claims[${index}].evidenceIds`) };
    }),
  };
};
