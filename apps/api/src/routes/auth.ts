import { Router } from "express";
import {
  changePasswordSchema,
  demoAccessSchema,
  googleAuthSchema,
  loginSchema,
  signupSchema,
  updateAccountProfileSchema,
} from "@fuelledger/shared";
import { AppError } from "../lib/errors.js";
import {
  changePassword,
  currentUser,
  googleAuth,
  login,
  signup,
  startDemo,
  revokeSession,
  updateAccountProfile,
} from "../modules/auth/service.js";
import {
  assertNotThrottled,
  clearThrottle,
  recordFailure,
  throttleKey,
} from "../modules/auth/throttle.js";

export const authRouter = Router();
const sessionCookie =
  process.env.NODE_ENV === "production"
    ? "__Host-fuelledger_session"
    : "fuelledger_session";
const setSession = (
  res: Parameters<Parameters<typeof authRouter.post>[1]>[1],
  result: Awaited<ReturnType<typeof login>>,
) => {
  res.cookie(sessionCookie, result.token, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: result.maxAgeMs,
  });
  res.json({ user: result.user });
};
authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Please check the information entered.",
      parsed.error.flatten(),
    );
  const key = throttleKey("login", parsed.data.email, req.ip ?? "unknown");
  await assertNotThrottled(key);
  let result;
  try {
    result = await login(parsed.data, req.get("user-agent"));
    await clearThrottle(key);
  } catch (error) {
    await recordFailure(key);
    throw error;
  }
  setSession(res, result);
});
authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Please check the information entered.",
      parsed.error.flatten(),
    );
  setSession(res, await signup(parsed.data, req.get("user-agent")));
});
authRouter.post("/google", async (req, res) => {
  const parsed = googleAuthSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Google sign-in information is invalid.",
      parsed.error.flatten(),
    );
  setSession(res, await googleAuth(parsed.data, req.get("user-agent")));
});
authRouter.post("/demo", async (req, res) => {
  const parsed = demoAccessSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "Enter a valid email address or mobile number.",
      parsed.error.flatten(),
    );
  const result = await startDemo(parsed.data);
  res.cookie(sessionCookie, result.token, {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 48 * 60 * 60 * 1000,
  });
  res.json({ user: result.user });
});
authRouter.get("/me", async (req, res) => {
  const token = req.cookies[sessionCookie] as string | undefined;
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "Please sign in.");
  res.json({ user: await currentUser(token) });
});
authRouter.patch("/me", async (req, res) => {
  const token = req.cookies[sessionCookie] as string | undefined;
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "Please sign in.");
  const user = await currentUser(token);
  if (user.demoExpiresAt || user.mustChangePassword) {
    throw new AppError(403, "PROFILE_UNAVAILABLE", "Profile editing is unavailable for this session.");
  }
  const parsed = updateAccountProfileSchema.safeParse(req.body);
  if (!parsed.success) throw new AppError(400, "VALIDATION_ERROR", "Enter a name between 2 and 100 characters.");
  res.json({ user: await updateAccountProfile(user.id, parsed.data.name) });
});
authRouter.post("/change-password", async (req, res) => {
  const token = req.cookies[sessionCookie] as string | undefined;
  if (!token) throw new AppError(401, "UNAUTHENTICATED", "Please sign in.");
  const user = await currentUser(token);
  if (user.demoExpiresAt) throw new AppError(403, "PASSWORD_UNAVAILABLE", "Password changes are unavailable in the demo.");
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success)
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Check the passwords entered.",
      parsed.error.flatten(),
    );
  const key = throttleKey("change-password", user.id, req.ip ?? "unknown");
  await assertNotThrottled(key);
  try {
    await changePassword(user.id, parsed.data);
  } catch (error) {
    if (error instanceof AppError && error.code === "CURRENT_PASSWORD_REQUIRED") await recordFailure(key);
    throw error;
  }
  await clearThrottle(key);
  res.json({ ok: true });
});
authRouter.post("/logout", async (req, res) => {
  const token = req.cookies[sessionCookie] as string | undefined;
  if (token) await revokeSession(token);
  res.clearCookie(sessionCookie, {
    path: "/",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax",
    secure: process.env.NODE_ENV === "production",
  });
  res.status(204).send();
});
