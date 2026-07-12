import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createExecutionManifest } from "../src/proof-execution.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const value = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const stage = value("stage") || "240";
const batchId = value("batch") || "001";
const approvalPath = value("approval");
if (!approvalPath) throw new Error("--approval=<path> is required.");

const plan = JSON.parse(await readFile(path.join(root, "output", `proof-stage-${stage}-plan.json`), "utf8"));
const approval = JSON.parse(await readFile(path.resolve(root, approvalPath), "utf8"));
const manifest = createExecutionManifest(plan, batchId, approval);
const outputDir = path.join(root, "output", "execution");
const outputFile = path.join(outputDir, `stage-${stage}-batch-${batchId}.json`);
await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(outputFile);
