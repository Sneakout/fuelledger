import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

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

let finalExitCode = 1;

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

  const isAdvisoryLockTimeout =
    result.output.includes("P1002") &&
    /advisory lock|pg_advisory_lock/i.test(result.output);

  if (!isAdvisoryLockTimeout || attempt === retryDelaysMs.length - 1) {
    finalExitCode = result.code;
    break;
  }
}

process.exitCode = finalExitCode;
