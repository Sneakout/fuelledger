import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { assertLocalNerveScope, authenticateLocalNerve } from "../modules/nerve/local-auth.js";
import { nerveReadCapabilities, readForNerve } from "../modules/nerve/read-service.js";

export const nerveReadRouter = Router();
const bodySchema = z.object({ capability: z.enum(nerveReadCapabilities), organizationId: z.string().min(1), stationIds: z.array(z.string().min(1)).length(1), asOf: z.iso.datetime(), startDate: z.iso.date().optional(), endDate: z.iso.date().optional(), evidenceId: z.string().min(1).optional() }).strict();

nerveReadRouter.post("/read", async (req, res) => {
  const keyId = req.get("x-nerve-key-id"), timestamp = req.get("x-nerve-timestamp"), nonce = req.get("x-nerve-nonce"), signature = req.get("x-nerve-signature");
  const trusted = authenticateLocalNerve({ credentials: { enabled: env.NERVE_LOCAL_SHADOW_ENABLED, nodeEnv: env.NODE_ENV, ...(env.NERVE_LOCAL_KEY_ID ? { keyId: env.NERVE_LOCAL_KEY_ID } : {}), ...(env.NERVE_LOCAL_SHARED_SECRET ? { sharedSecret: env.NERVE_LOCAL_SHARED_SECRET } : {}), ...(env.NERVE_LOCAL_ORGANIZATION_ID ? { organizationId: env.NERVE_LOCAL_ORGANIZATION_ID } : {}), ...(env.NERVE_LOCAL_STATION_ID ? { stationId: env.NERVE_LOCAL_STATION_ID } : {}) }, ...(keyId ? { keyId } : {}), ...(timestamp ? { timestamp } : {}), ...(nonce ? { nonce } : {}), ...(signature ? { signature } : {}), body: req.body });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "NERVE_REQUEST_INVALID", "The Nerve read request is invalid.", parsed.error.flatten());
  assertLocalNerveScope(parsed.data, trusted);
  res.json(await readForNerve(parsed.data.capability, { organizationId: trusted.organizationId, stationId: trusted.stationId, asOf: parsed.data.asOf, ...(parsed.data.startDate ? { startDate: parsed.data.startDate } : {}), ...(parsed.data.endDate ? { endDate: parsed.data.endDate } : {}), ...(parsed.data.evidenceId ? { evidenceId: parsed.data.evidenceId } : {}) }));
});
