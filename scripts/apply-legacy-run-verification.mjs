import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { promoteLegacyProofToRunVerified, proofManifestEntry, validateLegacyRunDecisionBatch } from "../src/proof-promotion.mjs";
import { validatePromptV2 } from "../src/prompt-schema-v2.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const write = process.argv.includes("--write");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
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

const decisionFile = path.join(root, "data", "proofs", "legacy-run-verification-decisions.json");
const auditFile = path.join(root, "data", "reports", "legacy-proof-audit.json");
const manifestFile = path.join(root, "data", "proofs", "manifest-v2.json");
const reportFile = path.join(root, "data", "reports", "legacy-run-verification.json");
const [rawDecision, audit, manifest, previousReport, promptFiles] = await Promise.all([
  readJson(decisionFile),
  readJson(auditFile),
  readJson(manifestFile),
  readJson(reportFile).catch((error) => error.code === "ENOENT" ? null : Promise.reject(error)),
  walk(path.join(root, "data", "prompts"))
]);
const decision = validateLegacyRunDecisionBatch(rawDecision);
const promptRecords = await Promise.all(promptFiles.map(async (file) => ({ file, prompt: await readJson(file) })));
const byId = new Map(promptRecords.map((record) => [record.prompt.id, record]));
const reportEntries = {};

for (const id of decision.approvedIds) {
  const record = byId.get(id);
  const auditEntry = audit.entries?.[id];
  if (!record || !auditEntry) throw new Error(`Decision references missing prompt or audit evidence: ${id}`);
  const previousStatus = previousReport?.entries?.[id]?.previousStatus || record.prompt.proof?.status || "";
  record.prompt = promoteLegacyProofToRunVerified(record.prompt, auditEntry, decision);
  const errors = validatePromptV2(record.prompt);
  if (errors.length) throw new Error(`Invalid promoted prompt ${id}: ${errors.join(", ")}`);
  manifest.entries[id] = proofManifestEntry(record.prompt.proof);
  reportEntries[id] = {
    id,
    previousStatus,
    status: record.prompt.proof.status,
    verificationType: decision.verificationType,
    humanStatus: record.prompt.proof.qa.humanStatus,
    inputSha256: record.prompt.proof.run.inputSha256,
    outputSha256: record.prompt.proof.run.outputSha256,
    assetKey: record.prompt.proof.assets.find((asset) => asset.role === "primary")?.key || "",
    checks: decision.checks
  };
}

manifest.releaseBatch = decision.decisionBatch;
manifest.updatedAt = decision.verifiedAt;
const decisionSha256 = createHash("sha256").update(`${JSON.stringify(rawDecision, null, 2)}\n`).digest("hex");
const report = {
  schemaVersion: 1,
  decisionBatch: decision.decisionBatch,
  decisionSha256,
  verifiedAt: decision.verifiedAt,
  verificationType: decision.verificationType,
  humanReviewClaimed: false,
  summary: {
    approved: decision.approvedIds.length,
    runVerified: Object.values(reportEntries).filter((entry) => entry.status === "run-verified").length,
    humanReviewed: 0
  },
  entries: reportEntries
};

if (write) {
  for (const id of decision.approvedIds) {
    const record = byId.get(id);
    await writeFile(record.file, `${JSON.stringify(record.prompt, null, 2)}\n`, "utf8");
  }
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await mkdir(path.join(root, "data", "reports"), { recursive: true });
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({ mode: write ? "write" : "dry-run", ...report.summary, decisionSha256 }, null, 2));
