import { AgentSdkError } from "../errors.ts";
export type SdkRelease = { packageName: string; version: string; contractVersions: string[]; status: "CURRENT" | "SUPPORTED" | "DEPRECATED" | "RETIRED"; releasedAt: string; supportEndsAt?: string };
export class SdkReleaseCatalog {
  private readonly releases = new Map<string, SdkRelease>();
  publish(release: SdkRelease) { if (!/^\d+\.\d+\.\d+$/.test(release.version) || !release.contractVersions.length) throw new AgentSdkError("INVALID_REQUEST", "SDK release or contract versions are invalid."); const key = `${release.packageName}@${release.version}`; if (this.releases.has(key)) throw new AgentSdkError("INVALID_REQUEST", "SDK release is immutable and already published."); this.releases.set(key, structuredClone(release)); }
  negotiate(packageName: string, requestedContract: string) { const major = requestedContract.split(".")[0]; const candidates = [...this.releases.values()].filter(item => item.packageName === packageName && item.status !== "RETIRED" && item.contractVersions.some(version => version.split(".")[0] === major)).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true })); if (!candidates[0]) throw new AgentSdkError("CONTRACT_VERSION_UNSUPPORTED", "No supported SDK release can negotiate this contract major version."); return structuredClone(candidates[0]); }
  list(packageName: string) { return structuredClone([...this.releases.values()].filter(item => item.packageName === packageName)); }
}
