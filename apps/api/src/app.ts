import crypto from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { Prisma } from "@prisma/client";
import { env } from "./config/env.js";
import { AppError } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { authRouter } from "./routes/auth.js";
import { stationsRouter } from "./routes/stations.js";
import { productsRouter } from "./routes/products.js";
import { shiftsRouter } from "./routes/shifts.js";
import { salesRouter } from "./routes/sales.js";
import { inventoryRouter } from "./routes/inventory.js";
import { reconciliationRouter } from "./routes/reconciliation.js";
import { customersRouter } from "./routes/customers.js";
import { purchasesRouter } from "./routes/purchases.js";
import { accountingRouter } from "./routes/accounting.js";
import { reportsRouter } from "./routes/reports.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { accessRouter } from "./routes/access.js";
import { platformRouter } from "./routes/platform.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id =
          req.headers["x-request-id"]?.toString() ?? crypto.randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://accounts.google.com"],
          frameSrc: ["'self'", "https://accounts.google.com"],
          connectSrc: ["'self'", env.CORS_ORIGIN],
          imgSrc: ["'self'", "data:", "https:"],
          styleSrc: ["'self'", "'unsafe-inline'", "https:"],
        },
      },
    }),
  );
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use((req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (origin && origin !== env.CORS_ORIGIN && origin !== env.APP_URL) {
      return next(
        new AppError(
          403,
          "ORIGIN_NOT_ALLOWED",
          "This request did not come from the FuelLedger application.",
        ),
      );
    }
    next();
  });
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please try again shortly.",
        },
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.get("/api/health", async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", database: "connected" });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/stations", stationsRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/shifts", shiftsRouter);
  app.use("/api/sales", salesRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/reconciliation", reconciliationRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/purchases", purchasesRouter);
  app.use("/api/accounting", accountingRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/access", accessRouter);
  app.use("/api/platform", platformRouter);
  app.use("/api", (_req, _res) => {
    throw new AppError(
      404,
      "NOT_FOUND",
      "The requested resource was not found.",
    );
  });
  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    const known = error instanceof AppError;
    const databaseUnavailable =
      error instanceof Prisma.PrismaClientInitializationError;
    const status = known ? error.status : databaseUnavailable ? 503 : 500;
    req.log.error({ err: error, requestId: req.id }, "request failed");
    res
      .status(status)
      .json({
        error: {
          code: known
            ? error.code
            : databaseUnavailable
              ? "DATABASE_UNAVAILABLE"
              : "INTERNAL_ERROR",
          message: known
            ? error.message
            : databaseUnavailable
              ? "Database is unavailable."
              : "Something went wrong.",
          requestId: req.id,
          ...(known && error.details ? { details: error.details } : {}),
        },
      });
  };
  app.use(errorHandler);
  return app;
}
