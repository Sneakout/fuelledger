import { createHash } from "node:crypto";

export type InvoiceImportReleaseInput = {
  stage: "OFF" | "LOCAL" | "STAGING" | "PRODUCTION";
  rolloutPercent: number;
  monitoringPercent: number;
  rollback: boolean;
  environment: "development" | "test" | "production";
  organizationId: string;
  userId: string;
  role: string;
};

export function invoiceImportReleasePolicy(input: InvoiceImportReleaseInput) {
  const correctStage = input.environment === "production" ? input.stage === "PRODUCTION" : input.stage !== "OFF";
  const eligibleRole = input.role === "OWNER";
  const enabled = !input.rollback && correctStage && eligibleRole && bucket(`${input.organizationId}:${input.userId}:invoice-import`) < input.rolloutPercent;
  const monitored = enabled && bucket(`${input.organizationId}:${input.userId}:invoice-import-monitoring`) < input.monitoringPercent;
  return { enabled, monitored, readOnlyDemo: false, stage: input.stage } as const;
}

function bucket(value: string) {
  return createHash("sha256").update(value).digest().readUInt32BE(0) % 100;
}
