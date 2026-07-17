import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildInputReviewPack } from "../src/proof-execution.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const value = (name, fallback = "") => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const stage = value("stage", "240");
const batchId = value("batch", "001");
const planPath = value("plan", `output/proof-stage-${stage}-plan.json`);
const plan = JSON.parse(await readFile(path.resolve(root, planPath), "utf8"));
const reviewPack = buildInputReviewPack(plan, batchId);
const outputDir = path.join(root, "output", "input-review", `stage-${stage}`);
const outputFile = path.join(outputDir, `batch-${batchId}.json`);
await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(reviewPack, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputFile, batchId, inputsRequiringReview: reviewPack.items.length }, null, 2));
