import type { AgentError, JsonObject } from "../../contracts.ts";
import type { ControlledActionId, SourceActionExecutor, SourceActionRequest, SourceActionResult } from "../../execution-contracts.ts";
import { FUELNERVE_APPLICATION_ID } from "./types.ts";

export type FuelNerveActionHandler = (input: { request: SourceActionRequest; currentFacts: JsonObject }) => Promise<{ sourceCommandId: string; result?: JsonObject; status?: "SUCCEEDED" | "FAILED" | "UNKNOWN" }>;

export type FuelNerveControlledActionDependencies = {
  authorize(request: SourceActionRequest): Promise<boolean>;
  reloadFacts(request: SourceActionRequest): Promise<JsonObject>;
  validateLedger(request: SourceActionRequest, currentFacts: JsonObject): Promise<boolean>;
  validateJournal(request: SourceActionRequest, currentFacts: JsonObject): Promise<boolean>;
  validateMessagePolicy(request: SourceActionRequest, currentFacts: JsonObject): Promise<boolean>;
  handlers: Partial<Record<ControlledActionId, FuelNerveActionHandler>>;
};

const needsLedger = new Set<ControlledActionId>(["inventory.adjustment.submit", "inventory.adjustment.apply"]);
const needsJournal = new Set<ControlledActionId>(["inventory.adjustment.apply", "purchases.invoice-correction.submit"]);
const needsMessagePolicy = new Set<ControlledActionId>(["communications.customer-reminder.send"]);

/** FuelNerve-owned boundary: handlers call authenticated domain services, never Prisma from Nerve. */
export class FuelNerveControlledActionAdapter implements SourceActionExecutor {
  readonly applicationId = FUELNERVE_APPLICATION_ID;
  private readonly dependencies: FuelNerveControlledActionDependencies;
  constructor(dependencies: FuelNerveControlledActionDependencies) { this.dependencies = dependencies; }

  async execute(request: SourceActionRequest): Promise<SourceActionResult> {
    const finalAuthorization = await this.dependencies.authorize(request);
    if (!finalAuthorization) return rejected("FuelNerve final authorization denied the action.", { finalAuthorization, factsReloaded: false });
    const currentFacts = await this.dependencies.reloadFacts(request);
    const checks = {
      finalAuthorization,
      factsReloaded: true,
      ...(needsLedger.has(request.actionId) ? { ledgerInvariants: await this.dependencies.validateLedger(request, currentFacts) } : {}),
      ...(needsJournal.has(request.actionId) ? { journalInvariants: await this.dependencies.validateJournal(request, currentFacts) } : {}),
      ...(needsMessagePolicy.has(request.actionId) ? { explicitMessagePolicy: await this.dependencies.validateMessagePolicy(request, currentFacts) } : {}),
    };
    if (checks.ledgerInvariants === false || checks.journalInvariants === false || checks.explicitMessagePolicy === false) return rejected("FuelNerve deterministic validation rejected the action.", checks);
    const handler = this.dependencies.handlers[request.actionId];
    if (!handler) return rejected("This FuelNerve action has no registered domain handler.", checks);
    try {
      const result = await handler({ request, currentFacts });
      return { status: result.status ?? "SUCCEEDED", sourceCommandId: result.sourceCommandId, ...(result.result ? { result: result.result } : {}), checks };
    } catch (error) {
      const uncertain = error instanceof FuelNerveUncertainOutcomeError;
      return { status: uncertain ? "UNKNOWN" : "FAILED", checks, error: sourceError(uncertain ? "FuelNerve could not determine whether the command completed." : "FuelNerve rejected or failed the command.", uncertain) };
    }
  }
}

export class FuelNerveUncertainOutcomeError extends Error {}

function rejected(message: string, checks: SourceActionResult["checks"]): SourceActionResult { return { status: "REJECTED", checks, error: sourceError(message, false) }; }
function sourceError(message: string, reviewRequired: boolean): AgentError { return { code: "TOOL_FAILED", message, retryable: false, ...(reviewRequired ? { details: { reviewRequired: true } } : {}) }; }
