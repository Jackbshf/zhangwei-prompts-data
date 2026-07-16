import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCostPlan } from "../src/proof-costing.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const value = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
const stage = value("stage") || "240";
const pricingPath = value("pricing");
const plan = JSON.parse(await readFile(path.join(root, "output", `proof-stage-${stage}-plan.json`), "utf8"));
const pricing = pricingPath ? JSON.parse(await readFile(path.resolve(root, pricingPath), "utf8")) : {};
const costPlan = buildCostPlan(plan, pricing);
const outputFile = path.join(root, "output", `stage-${stage}-cost-plan.json`);
await writeFile(outputFile, `${JSON.stringify(costPlan, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputFile,
  approvalReady: costPlan.approvalReady,
  missing: costPlan.missing,
  summary: costPlan.summary
}, null, 2));
