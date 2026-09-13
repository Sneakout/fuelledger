import { describe, expect, it } from "vitest";
import { invoiceImportReleasePolicy } from "./invoice-import-release.js";

const base = { stage: "PRODUCTION" as const, rolloutPercent: 100, monitoringPercent: 100, rollback: false, environment: "production" as const, organizationId: "org-1", userId: "owner-1", role: "OWNER" };

describe("invoice import release policy", () => {
  it("allows only an explicitly enabled production cohort", () => {
    expect(invoiceImportReleasePolicy(base)).toMatchObject({ enabled: true, monitored: true });
    expect(invoiceImportReleasePolicy({ ...base, rolloutPercent: 0 }).enabled).toBe(false);
    expect(invoiceImportReleasePolicy({ ...base, stage: "STAGING" }).enabled).toBe(false);
  });

  it("provides immediate rollback and owner-only access", () => {
    expect(invoiceImportReleasePolicy({ ...base, rollback: true }).enabled).toBe(false);
    expect(invoiceImportReleasePolicy({ ...base, role: "STAFF" }).enabled).toBe(false);
  });

  it("keeps cohort and monitoring selection stable", () => {
    const first = invoiceImportReleasePolicy({ ...base, rolloutPercent: 37, monitoringPercent: 41 });
    const second = invoiceImportReleasePolicy({ ...base, rolloutPercent: 37, monitoringPercent: 41 });
    expect(second).toEqual(first);
  });
});
