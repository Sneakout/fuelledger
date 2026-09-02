import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import type {
  ChangePasswordInput,
  DemoAccessInput,
  GoogleAuthInput,
  LoginInput,
  SignupInput,
  User,
} from "@fuelledger/shared";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";

export async function login(
  input: LoginInput,
  userAgent?: string,
): Promise<{ token: string; user: User }> {
  const record = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: userInclude,
  });
  if (
    !record ||
    !record.active ||
    !record.loginEnabled ||
    !(await bcrypt.compare(input.password, record.passwordHash))
  )
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect.",
    );
  await prisma.user.update({
    where: { id: record.id },
    data: { lastLoginAt: new Date() },
  });
  return session(record, userAgent);
}

export async function signup(input: SignupInput, userAgent?: string) {
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } }))
    throw new AppError(
      409,
      "EMAIL_EXISTS",
      "An account already exists for this email address.",
    );
  const passwordHash = await bcrypt.hash(input.password, 12);
  const record = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: input.organizationName },
    });
    await tx.station.create({
      data: {
        organizationId: organization.id,
        name: input.organizationName,
        code: "PUMP-1",
        addressLine1: "To be configured",
        city: "To be configured",
        state: "To be configured",
        postalCode: "0000",
      },
    });
    return tx.user.create({
      data: {
        organizationId: organization.id,
        email,
        name: input.name,
        passwordHash,
        role: "OWNER",
      },
      include: userInclude,
    });
  });
  return session(record, userAgent);
}

export async function googleAuth(input: GoogleAuthInput, userAgent?: string) {
  if (!env.GOOGLE_CLIENT_ID)
    throw new AppError(
      503,
      "GOOGLE_AUTH_UNAVAILABLE",
      "Google sign-in is not configured.",
    );
  const ticket = await new OAuth2Client(env.GOOGLE_CLIENT_ID)
    .verifyIdToken({
      idToken: input.credential,
      audience: env.GOOGLE_CLIENT_ID,
    })
    .catch(() => null);
  const payload = ticket?.getPayload();
  if (!payload?.email || !payload.email_verified)
    throw new AppError(
      401,
      "GOOGLE_TOKEN_INVALID",
      "Google could not verify this account.",
    );
  let record = await prisma.user.findUnique({
    where: { email: payload.email.toLowerCase() },
    include: userInclude,
  });
  if (!record) {
    if (!input.organizationName)
      throw new AppError(
        400,
        "BUSINESS_NAME_REQUIRED",
        "Enter your petrol pump name before creating an account with Google.",
      );
    record = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: input.organizationName! },
      });
      await tx.station.create({
        data: {
          organizationId: organization.id,
          name: input.organizationName!,
          code: "PUMP-1",
          addressLine1: "To be configured",
          city: "To be configured",
          state: "To be configured",
          postalCode: "0000",
        },
      });
      return tx.user.create({
        data: {
          organizationId: organization.id,
          email: payload.email!.toLowerCase(),
          name: payload.name || payload.email!.split("@")[0]!,
          passwordHash: await bcrypt.hash(crypto.randomUUID(), 12),
          role: "OWNER",
        },
        include: userInclude,
      });
    });
  }
  if (!record.active || !record.loginEnabled)
    throw new AppError(401, "ACCOUNT_INACTIVE", "This account is inactive.");
  await prisma.user.update({
    where: { id: record.id },
    data: { lastLoginAt: new Date() },
  });
  return session(record, userAgent);
}

export async function startDemo(input: DemoAccessInput) {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@fuelledger.local" },
    include: userInclude,
  });
  if (!owner || !owner.active)
    throw new AppError(
      503,
      "DEMO_UNAVAILABLE",
      "The product demo is temporarily unavailable.",
    );
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const contact = input.contact.includes("@")
    ? input.contact.toLowerCase()
    : input.contact.replace(/[\s-]/g, "");
  const demo = await prisma.demoSession.create({
    data: {
      contact,
      kind: contact.includes("@") ? "EMAIL" : "MOBILE",
      expiresAt,
    },
  });
  const token = jwt.sign(
    {
      sub: owner.id,
      role: owner.role,
      organizationId: owner.organizationId,
      demoSessionId: demo.id,
    },
    env.JWT_SECRET,
    { expiresIn: "48h" },
  );
  return { token, user: present(owner, expiresAt) };
}

export async function currentUser(token: string): Promise<User> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    throw new AppError(
      401,
      "UNAUTHENTICATED",
      "Your session has expired. Please sign in again.",
    );
  }
  let demoExpiresAt: Date | undefined;
  if (payload.demoSessionId) {
    const demo = await prisma.demoSession.findUnique({
      where: { id: String(payload.demoSessionId) },
    });
    if (!demo || demo.expiresAt <= new Date())
      throw new AppError(
        401,
        "DEMO_EXPIRED",
        "Your 48-hour demo has ended. Start a new demo to continue.",
      );
    demoExpiresAt = demo.expiresAt;
  } else {
    const sessionId = String(payload.jti ?? "");
    const session = sessionId
      ? await prisma.userSession.findUnique({ where: { id: sessionId } })
      : null;
    if (
      !session ||
      session.userId !== String(payload.sub) ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    )
      throw new AppError(
        401,
        "SESSION_REVOKED",
        "This session is no longer active. Please sign in again.",
      );
  }
  const record = await prisma.user.findUnique({
    where: { id: String(payload.sub) },
    include: userInclude,
  });
  if (!record || !record.active || !record.loginEnabled)
    throw new AppError(401, "UNAUTHENTICATED", "User is unavailable.");
  return present(record, demoExpiresAt);
}

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await bcrypt.hash(input.password, 12),
      mustChangePassword: false,
    },
  });
}

export async function revokeSession(token: string) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    if (payload.jti)
      await prisma.userSession.updateMany({
        where: { id: String(payload.jti), userId: String(payload.sub) },
        data: { revokedAt: new Date() },
      });
  } catch {
    return;
  }
}

const userInclude = {
  organization: true,
  stationAccess: {
    where: { station: { active: true } },
    include: { station: { select: { id: true, name: true, code: true } } },
  },
} as const;
function present(
  record: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>> & {
    organization: { id: string; name: string };
    stationAccess: Array<{
      station: { id: string; name: string; code: string };
    }>;
  },
  demoExpiresAt?: Date,
): User {
  const allStations = record.role === "OWNER" || record.role === "ACCOUNTANT";
  return {
    id: record.id,
    email: record.email,
    name: demoExpiresAt ? "Demo Visitor" : record.name,
    role: record.role,
    organization: {
      id: record.organization.id,
      name: record.organization.name,
    },
    allStations,
    stations: record.stationAccess.map((item) => item.station),
    mustChangePassword: record.mustChangePassword,
    ...(demoExpiresAt ? { demoExpiresAt: demoExpiresAt.toISOString() } : {}),
  };
}
async function session(
  record: Parameters<typeof present>[0],
  userAgent?: string,
) {
  const user = present(record);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await prisma.userSession.create({
    data: {
      id,
      userId: record.id,
      expiresAt,
      ...(userAgent ? { userAgent: userAgent.slice(0, 500) } : {}),
    },
  });
  const token = jwt.sign(
    {
      sub: record.id,
      role: record.role,
      organizationId: record.organizationId,
      jti: id,
    },
    env.JWT_SECRET,
    { expiresIn: "8h" },
  );
  return { token, user };
}
