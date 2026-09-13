import { AgentSdkError } from "./errors.ts";

export function negotiateContractVersion(requested: string, supported: readonly string[]): string {
  if (supported.includes(requested)) return requested;
  const requestedMajor = requested.split(".")[0];
  const compatible = supported.filter(version => version.split(".")[0] === requestedMajor).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  if (compatible[0]) return compatible[0];
  throw new AgentSdkError("CONTRACT_VERSION_UNSUPPORTED", `Contract ${requested} is unsupported.`, false, { requested, supported: [...supported] });
}
