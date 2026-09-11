import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { Prisma } from "@prisma/client";
import type {
  ChangePasswordInput,
  DemoAccessInput,
  GoogleAuthInput,
  LoginInput,
  SignupInput,
  User,
} from "@fuelledger/shared";
import { env, isPlatformAdminEmail } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { defaultExpenseCategories } from "../../lib/default-expense-categories.js";

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
    await tx.expenseCategory.createMany({data:defaultExpenseCategories.map(category=>({organizationId:organization.id,...category})),skipDuplicates:true});
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
    const initialPumpName = "My Petrol Pump";
    record = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: initialPumpName },
      });
      await tx.station.create({
        data: {
          organizationId: organization.id,
          name: initialPumpName,
          code: "PUMP-1",
          addressLine1: "To be configured",
          city: "To be configured",
          state: "To be configured",
          postalCode: "0000",
        },
      });
      await tx.expenseCategory.createMany({data:defaultExpenseCategories.map(category=>({organizationId:organization.id,...category})),skipDuplicates:true});
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
  await refreshDemoShowcaseDates();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const contact = input.contact.includes("@")
    ? input.contact.trim().toLowerCase()
    : (() => { const digits=input.contact.replace(/\D/g, ""); return digits.length===10 ? `91${digits}` : digits; })();
  const kind = contact.includes("@") ? "EMAIL" : "MOBILE";
  let demo;
  try {
    demo = await prisma.$transaction(async tx => {
      await tx.demoAccessClaim.create({ data: { contact, kind } });
      return tx.demoSession.create({ data: { contact, kind, expiresAt } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      demo = await prisma.demoSession.findFirst({
        where: { contact, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
      });
      if (!demo)
        throw new AppError(409, "DEMO_EXPIRED", "This contact has already used its free 48-hour demo. Contact FuelNerve to continue.");
    } else {
      throw error;
    }
  }
  const token = jwt.sign(
    {
      sub: owner.id,
      role: owner.role,
      organizationId: owner.organizationId,
      demoSessionId: demo.id,
    },
    env.JWT_SECRET,
    { expiresIn: Math.max(1, Math.floor((demo.expiresAt.getTime() - Date.now()) / 1000)) },
  );
  return { token, user: present(owner, expiresAt) };
}

const demoDate = (daysAgo: number, hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return date;
};

/** Keeps the shared, read-only product tour current without touching customer data. */
async function refreshDemoShowcaseDates() {
  await prisma.$transaction(async (tx) => {
    for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
      const shiftId = `demo-real-shift-${daysAgo}`;
      const openedAt = demoDate(daysAgo, 6);
      const closedAt = demoDate(daysAgo, 22);
      await tx.shift.updateMany({
        where: { id: shiftId },
        data: { openedAt, closedAt },
      });
      const sales = await tx.sale.findMany({
        where: { id: { startsWith: `demo-real-sale-${daysAgo}-` } },
        select: { id: true, customerId: true },
        orderBy: { id: "asc" },
      });
      for (const [index, sale] of sales.entries()) {
        const occurredAt = demoDate(daysAgo, 10 + index);
        await tx.sale.update({ where: { id: sale.id }, data: { occurredAt } });
        await tx.journal.updateMany({
          where: { sourceType: "DEMO_SALE", sourceId: sale.id },
          data: { journalDate: occurredAt },
        });
        if (sale.customerId) {
          const customer = await tx.customer.findUnique({
            where: { id: sale.customerId },
            select: { creditDays: true },
          });
          const dueDate = new Date(occurredAt);
          dueDate.setDate(dueDate.getDate() + (customer?.creditDays ?? 0));
          await tx.customerLedgerEntry.updateMany({
            where: { saleId: sale.id },
            data: { occurredAt, dueDate },
          });
        }
      }
      await tx.shiftReconciliation.updateMany({
        where: { shiftId },
        data: { reconciledAt: closedAt, lockedAt: closedAt },
      });
    }
    await tx.shift.updateMany({
      where: { id: "demo-real-open-shift" },
      data: { openedAt: demoDate(0, 6) },
    });
    for (const purchase of [
      { id: "demo-purchase-hsd-paid", daysAgo: 5 },
      { id: "demo-purchase-ms-open", daysAgo: 1 },
    ]) {
      const invoiceDate = demoDate(purchase.daysAgo, 8);
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + 3);
      await tx.purchaseInvoice.updateMany({
        where: { id: purchase.id },
        data: { invoiceDate, dueDate },
      });
      await tx.purchaseReceipt.updateMany({
        where: { invoiceId: purchase.id },
        data: { receivedAt: invoiceDate },
      });
      await tx.supplierPayment.updateMany({
        where: { invoiceId: purchase.id },
        data: { paidAt: invoiceDate },
      });
      await tx.journal.updateMany({
        where: { sourceType: "PURCHASE_INVOICE", sourceId: purchase.id },
        data: { journalDate: invoiceDate },
      });
    }
  }, { maxWait: 10_000, timeout: 30_000 });
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
    await refreshDemoShowcaseDates();
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
    isPlatformAdmin: isPlatformAdminEmail(record.email),
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
