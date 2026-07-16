import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildReplacementPlan } from "../src/proof-planning.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function arg(name, fallback) {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
}

const planFile = path.resolve(root, arg("plan", "output/proof-stage-240-plan.json"));
const auditFile = path.resolve(root, arg("audit", "data/reports/legacy-proof-audit.json"));
const [plan, audit] = await Promise.all([
  readFile(planFile, "utf8").then(JSON.parse),
  readFile(auditFile, "utf8").then(JSON.parse)
]);
const reviewItems = plan.items
  .filter((item) => item.selectionReason === "legacy-image-review")
  .map((item) => {
    const evidence = audit.entries?.[item.id];
    if (!evidence) throw new Error(`Legacy review item is missing audit evidence: ${item.id}`);
    return {
      id: item.id,
      title: item.title,
      assetUrl: evidence.asset?.url || "",
      eligibility: evidence.eligibility,
      blockers: evidence.blockers,
      automatedStatus: evidence.automatedStatus,
      humanStatus: "not-reviewed",
      decision: "pending",
      requiredChecks: [
        "prompt-id-match",
        "visual-relevance",
        "no-duplicate-image",
        "no-watermark-or-recognizable-brand",
        "no-garbled-readable-text",
        "no-obvious-anatomy-or-object-failure",
        "commercial-safety"
      ]
    };
  });
const replacementPlan = buildReplacementPlan(plan, audit);
const reviewPack = {
  version: "legacy-image-review-pack-v2",
  stageTarget: plan.stageTarget,
  sourceAudit: path.relative(root, auditFile).replaceAll("\\", "/"),
  humanApprovalRequired: true,
  summary: {
    total: reviewItems.length,
    readyForHumanReview: reviewItems.filter((item) => item.eligibility === "human-review-ready").length,
    regenerationRequired: reviewItems.filter((item) => item.eligibility === "regenerate-required").length,
    humanReviewed: 0
  },
  items: reviewItems
};
const outputDir = path.join(root, "output");
await mkdir(outputDir, { recursive: true });
const reviewFile = path.join(outputDir, `stage-${plan.stageTarget}-legacy-image-review-pack.json`);
const replacementFile = path.join(outputDir, `proof-stage-${plan.stageTarget}-replacement-plan.json`);
await writeFile(reviewFile, `${JSON.stringify(reviewPack, null, 2)}\n`, "utf8");
await writeFile(replacementFile, `${JSON.stringify(replacementPlan, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  reviewFile,
  replacementFile,
  reviewSummary: reviewPack.summary,
  replacementSummary: replacementPlan.summary
}, null, 2));
