import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const findings = [];
const patterns = [
  { name: "private-key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "aws-access-key", expression: /AKIA[0-9A-Z]{16}/ },
  { name: "github-token", expression: /gh[pousr]_[A-Za-z0-9_]{30,}/ },
  { name: "openai-key", expression: /sk-[A-Za-z0-9_-]{32,}/ },
];
for (const file of await files(join(root, "src"))) {
  const content = await readFile(file, "utf8");
  for (const pattern of patterns) if (pattern.expression.test(content)) findings.push(`${relative(root, file)}:${pattern.name}`);
}
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (Object.keys(manifest.dependencies ?? {}).length) findings.push("package.json:production-dependencies-require-external-advisory-scan");
if (findings.length) { process.stderr.write(`${findings.join("\n")}\n`); process.exitCode = 1; }
else process.stdout.write("Security scan passed: no recognized secret material or production package dependencies.\n");

async function files(directory) { const output = []; for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) output.push(...await files(path)); else if (/\.(?:ts|js|json|sql)$/.test(entry.name)) output.push(path); } return output; }
