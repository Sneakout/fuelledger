import {
  managerInputSchema,
  nozzleCustodySchema,
  staffInputSchema,
  stationAccessInputSchema,
} from "@fuelledger/shared";
import { Router } from "express";
import { AppError } from "../lib/errors.js";
import { requireOwner } from "../lib/station-access.js";
import { authenticate } from "../middleware/authenticate.js";
import * as service from "../modules/access/service.js";

export const accessRouter = Router();
accessRouter.use(authenticate);
accessRouter.get("/context", async (req, res) =>
  res.json(await service.context(req.user!)),
);
accessRouter.get("/", async (req, res) => {
  requireOwner(req.user!);
  res.json(await service.management(req.user!.organization.id));
});
accessRouter.post("/users", async (req, res) => {
  requireOwner(req.user!);
  const parsed = staffInputSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      400,
      "STAFF_INVALID",
      "Complete the staff details.",
      parsed.error.flatten(),
    );
  res
    .status(201)
    .json({
      user: await service.createStaff(req.user!.organization.id, parsed.data),
    });
});
accessRouter.post("/managers", async (req, res) => {
  requireOwner(req.user!);
  const parsed = managerInputSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      400,
      "MANAGER_INVALID",
      "Complete the manager login details.",
      parsed.error.flatten(),
    );
  res
    .status(201)
    .json({
      user: await service.createManager(req.user!.organization.id, parsed.data),
    });
});
accessRouter.put("/users/:id", async (req, res) => {
  requireOwner(req.user!);
  const parsed = stationAccessInputSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      400,
      "ACCESS_INVALID",
      "Choose valid petrol pump assignments.",
      parsed.error.flatten(),
    );
  res.json(
    await service.assign(
      req.user!.organization.id,
      req.params.id!,
      parsed.data,
    ),
  );
});
accessRouter.delete("/users/:id", async (req, res) => {
  requireOwner(req.user!);
  res.json(
    await service.deactivateStaff(req.user!.organization.id, req.params.id!),
  );
});
accessRouter.put(
  "/stations/:stationId/nozzle-assignments",
  async (req, res) => {
    requireOwner(req.user!);
    const parsed = nozzleCustodySchema.safeParse(req.body);
    if (!parsed.success)
      throw new AppError(
        400,
        "CUSTODY_INVALID",
        "Assign every nozzle to an attendant.",
        parsed.error.flatten(),
      );
    res.json(
      await service.saveNozzleAssignments(
        req.user!.organization.id,
        req.params.stationId!,
        parsed.data,
      ),
    );
  },
);
