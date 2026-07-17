import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyClassificationTaxonomy,
  buildClassificationTaxonomyReport
} from "../src/classification-taxonomy.mjs";

async function walkJson(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkJson(full));
    else if (entry.name.endsWith(".json")) files.push(full);
  }
  return files.sort();
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = await walkJson(path.join(root, "data", "prompts"));
const expectedPrompts = Number(process.env.EXPECTED_PROMPTS || 4167);
if (files.length !== expectedPrompts) {
  throw new Error(`Prompt count mismatch: expected ${expectedPrompts}, received ${files.length}.`);
}

const prompts = [];
const ids = new Set();
let changed = 0;

for (const file of files) {
  const source = JSON.parse(await readFile(file, "utf8"));
  if (!source.id || ids.has(source.id)) throw new Error(`Invalid or duplicate prompt id: ${source.id || "(missing)"}`);
  ids.add(source.id);
  const classified = applyClassificationTaxonomy(source);
  if (JSON.stringify(source.classification) !== JSON.stringify(classified.classification)) {
    await writeFile(file, `${JSON.stringify(classified, null, 2)}\n`, "utf8");
    changed += 1;
  }
  prompts.push(classified);
}

const report = buildClassificationTaxonomyReport(prompts);
if (report.incomplete !== 0) throw new Error(`${report.incomplete} prompt classifications remain incomplete.`);
const reportsDir = path.join(root, "data", "reports");
await mkdir(reportsDir, { recursive: true });
await writeFile(
  path.join(reportsDir, "classification-taxonomy-v1.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);

console.log(JSON.stringify({ prompts: prompts.length, changed, report }, null, 2));
