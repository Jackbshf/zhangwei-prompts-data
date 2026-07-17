import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const value = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
const stage = value("stage") || "240";
const costPlanPath = value("cost-plan") || `output/stage-${stage}-cost-plan.json`;
const costPlan = JSON.parse(await readFile(path.resolve(root, costPlanPath), "utf8"));
const commandAvailable = (command) => spawnSync(
  process.platform === "win32" ? "where.exe" : "which",
  [command],
  { stdio: "ignore", timeout: 10_000 }
).status === 0;
const dreaminaCommand = ["dreamina", "jimeng", "dreamina-cli"].find(commandAvailable) || "";
const checks = {
  pricingSnapshotApproved: costPlan.approvalReady === true,
  openaiApiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
  openaiImageModelMatchesLock: Boolean(process.env.OPENAI_IMAGE_MODEL)
    && process.env.OPENAI_IMAGE_MODEL === costPlan.modelLocks?.openaiImage,
  openaiTextModelMatchesLock: Boolean(process.env.OPENAI_TEXT_MODEL)
    && process.env.OPENAI_TEXT_MODEL === costPlan.modelLocks?.openaiText,
  dreaminaCliAvailable: Boolean(dreaminaCommand),
  paidExecutionExplicitlyEnabled: process.env.PROOF_PAID_EXECUTION === "APPROVED"
};
console.log(JSON.stringify({
  stageTarget: Number(stage),
  readyForPaidExecution: Object.values(checks).every(Boolean),
  checks,
  dreaminaCommand: dreaminaCommand || null,
  secrets: "Values are intentionally not printed."
}, null, 2));
