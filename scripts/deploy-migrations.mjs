import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prismaCli = fileURLToPath(
  new URL("../node_modules/prisma/build/index.js", import.meta.url),
);
const retryDelaysMs = [0, 5_000, 10_000, 20_000];
const migrationEnvironment = { ...process.env };

if (migrationEnvironment.DIRECT_URL) {
  migrationEnvironment.DATABASE_URL = migrationEnvironment.DIRECT_URL;
  process.stdout.write("Running database migrations over DIRECT_URL.\n");
} else {
  process.stdout.write(
    "DIRECT_URL is not configured; running database migrations over DATABASE_URL.\n",
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runMigration() {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: process.cwd(),
      env: migrationEnvironment,
      stdio: ["inherit", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      const text = `${error.name}: ${error.message}`;
      output += text;
      process.stderr.write(`${text}\n`);
      resolve({ code: 1, output });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

function resolveKnownRolledBackMigration(migrationName) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [prismaCli, "migrate", "resolve", "--rolled-back", migrationName],
      { cwd: process.cwd(), env: migrationEnvironment, stdio: "inherit" },
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function isVerifiedDailyBriefingCollision(output, migrationName) {
  if (
    output.includes("P3018") &&
    new RegExp(`Migration name:\\s*\`?${migrationName}\`?`).test(output) &&
    output.includes('column "intelligence_enabled_at"') &&
    output.includes("already exists")
  ) return true;
  if (!output.includes("P3009")) return false;
  const prisma = new PrismaClient({ datasourceUrl: migrationEnvironment.DATABASE_URL });
  try {
    const rows = await prisma.$queryRawUnsafe(
      'SELECT logs FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at DESC LIMIT 1',
      migrationName,
    );
    const logs = String(rows[0]?.logs ?? "");
    return logs.includes('column "intelligence_enabled_at"') && logs.includes("already exists");
  } catch {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

let finalExitCode = 1;
let recoveredDailyBriefingMigration = false;

for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
  if (retryDelaysMs[attempt] > 0) {
    process.stdout.write(
      `Migration lock is busy; retrying in ${retryDelaysMs[attempt] / 1_000} seconds ` +
        `(attempt ${attempt + 1}/${retryDelaysMs.length}).\n`,
    );
    await wait(retryDelaysMs[attempt]);
  }

  const result = await runMigration();
  if (result.code === 0) {
    finalExitCode = 0;
    break;
  }

  const dailyBriefingMigration = "20260907180000_daily_owner_briefing";
  const isKnownDailyBriefingFailure =
    !recoveredDailyBriefingMigration &&
    await isVerifiedDailyBriefingCollision(result.output, dailyBriefingMigration);
  if (isKnownDailyBriefingFailure) {
    process.stdout.write(
      `Recovering the known rolled-back ${dailyBriefingMigration} attempt before retrying.\n`,
    );
    if (await resolveKnownRolledBackMigration(dailyBriefingMigration)) {
      recoveredDailyBriefingMigration = true;
      const retry = await runMigration();
      finalExitCode = retry.code;
      break;
    }
  }

  const isAdvisoryLockTimeout =
    result.output.includes("P1002") &&
    /advisory lock|pg_advisory_lock/i.test(result.output);

  if (!isAdvisoryLockTimeout || attempt === retryDelaysMs.length - 1) {
    finalExitCode = result.code;
    break;
  }
}

process.exitCode = finalExitCode;
