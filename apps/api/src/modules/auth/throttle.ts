import crypto from "node:crypto";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
export const throttleKey = (scope: string, identifier: string, ip: string) =>
  crypto
    .createHash("sha256")
    .update(`${scope}:${identifier.toLowerCase()}:${ip}`)
    .digest("hex");
export async function assertNotThrottled(key: string) {
  const row = await prisma.authThrottle.findUnique({ where: { key } });
  if (row?.blockedUntil && row.blockedUntil > new Date())
    throw new AppError(
      429,
      "TOO_MANY_ATTEMPTS",
      "Too many attempts. Please wait 15 minutes and try again.",
    );
}
export async function recordFailure(key: string) {
  const now = new Date();
  const existing = await prisma.authThrottle.findUnique({ where: { key } });
  const expired =
    !existing || now.getTime() - existing.windowStartedAt.getTime() > WINDOW_MS;
  const attempts = expired ? 1 : existing.attempts + 1;
  await prisma.authThrottle.upsert({
    where: { key },
    create: {
      key,
      attempts,
      windowStartedAt: now,
      blockedUntil:
        attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + WINDOW_MS) : null,
    },
    update: {
      attempts,
      windowStartedAt: expired ? now : existing!.windowStartedAt,
      blockedUntil:
        attempts >= MAX_ATTEMPTS ? new Date(now.getTime() + WINDOW_MS) : null,
    },
  });
}
export async function clearThrottle(key: string) {
  await prisma.authThrottle.deleteMany({ where: { key } });
}
