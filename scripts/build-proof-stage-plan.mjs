import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { toPromptV2 } from "../src/prompt-schema-v2.mjs";
import { buildProofStagePlan } from "../src/proof-planning.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function numberArg(name, fallback) {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  return Number(value?.slice(name.length + 3) || fallback);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.name.endsWith(".json")) files.push(full);
  }
  return files.sort();
}

const stageTarget = numberArg("stage", 240);
const batchSize = numberArg("batch-size", 25);
const files = await walk(path.join(root, "data", "prompts"));
const prompts = await Promise.all(files.map(async (file) => {
  const prompt = JSON.parse(await readFile(file, "utf8"));
  return prompt.schemaVersion === 2 ? prompt : toPromptV2(prompt);
}));
const plan = buildProofStagePlan(prompts, { stageTarget, batchSize });
const output = {
  ...plan,
  generatedFrom: "canonical-data-repository",
  costGate: {
    pricingSnapshotRequired: true,
    approved: false,
    maximumUsd: null,
    maximumDreaminaCredits: null,
    estimatedR2Bytes: null
  },
  credentialsRequired: ["OPENAI_API_KEY", "Dreamina CLI login", "Cloudflare R2 write credentials"],
  paidExecutionInCi: false
};
const outputDir = path.join(root, "output");
const outputFile = path.join(outputDir, `proof-stage-${stageTarget}-plan.json`);
await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputFile, summary: output.summary, batches: output.batches.length }, null, 2));
