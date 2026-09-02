import type { NextFunction, Request, Response } from "express";
import type { User } from "@fuelledger/shared";
import { AppError } from "../lib/errors.js";
import { currentUser } from "../modules/auth/service.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const sessionCookie =
      process.env.NODE_ENV === "production"
        ? "__Host-fuelledger_session"
        : "fuelledger_session";
    const token = req.cookies[sessionCookie] as string | undefined;
    if (!token) throw new AppError(401, "UNAUTHENTICATED", "Please sign in.");
    req.user = await currentUser(token);
    if (req.user.mustChangePassword)
      throw new AppError(
        403,
        "PASSWORD_CHANGE_REQUIRED",
        "Create your private password before using FuelLedger.",
      );
    if (
      req.user.demoExpiresAt &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    )
      throw new AppError(
        403,
        "DEMO_READ_ONLY",
        "Demo mode is read-only. Create your account to start using FuelLedger.",
      );
    next();
  } catch (error) {
    next(error);
  }
}
