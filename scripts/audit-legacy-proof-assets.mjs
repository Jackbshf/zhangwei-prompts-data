import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLegacyProofAudit, buildLegacySourceInputMap } from "../src/proof-review.mjs";
import { validatePromptV2 } from "../src/prompt-schema-v2.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function arg(name) {
  return process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
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

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function manifestEntry(proof) {
  return {
    status: proof.status,
    modality: proof.modality,
    provider: proof.provider,
    model: proof.model,
    testedAt: proof.testedAt,
    evidenceLevel: proof.evidenceLevel,
    rights: proof.rights,
    assets: proof.assets,
    run: proof.run,
    qa: proof.qa
  };
}

const galleryArg = arg("legacy-gallery-dir");
const confirmedAt = arg("confirmed-at");
const write = process.argv.includes("--write");
if (!galleryArg) throw new Error("--legacy-gallery-dir=<path> is required.");
if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedAt)) throw new Error("--confirmed-at must use YYYY-MM-DD.");
const legacyGalleryDir = path.resolve(galleryArg);
const sourceSpecs = [
  {
    reference: "legacy-gallery/output/preview-image-batch-001.json",
    file: path.join(legacyGalleryDir, "output", "preview-image-batch-001.json")
  },
  {
    reference: "legacy-gallery/output/preview-image-stages/stage-01-batch-001-050.json",
    file: path.join(legacyGalleryDir, "output", "preview-image-stages", "stage-01-batch-001-050.json")
  }
];
const sources = [];
for (const spec of sourceSpecs) {
  const payload = await readJson(spec.file);
  sources.push({ reference: spec.reference, items: payload.items || [] });
}

const [legacyManifest, promptFiles] = await Promise.all([
  readJson(path.join(root, "data", "proofs", "manifest.json")),
  walk(path.join(root, "data", "prompts"))
]);
const promptRecords = await Promise.all(promptFiles.map(async (file) => ({ file, prompt: await readJson(file) })));
const promptById = new Map(promptRecords.map((record) => [record.prompt.id, record]));
const wantedIds = new Set(Object.keys(legacyManifest.images || {}));
const importedInputs = buildLegacySourceInputMap(sources);
const sourceInputs = Object.fromEntries(Object.entries(importedInputs).filter(([id]) => wantedIds.has(id)));
const proofEntries = {};
const auditEntries = {};
const summary = {
  total: 0,
  humanReviewReady: 0,
  regenerateRequired: 0,
  modality: { image: 0, video: 0, text: 0 },
  blockers: {}
};

for (const id of [...wantedIds].sort((left, right) => left.localeCompare(right, "en"))) {
  const record = promptById.get(id);
  if (!record?.prompt?.proof) throw new Error(`Legacy manifest references missing proof prompt: ${id}`);
  const legacyEntry = legacyManifest.images[id];
  const asset = record.prompt.proof.assets?.find((item) => item.storage === "repository" && item.role === "cover");
  if (!asset) throw new Error(`Legacy proof is missing its repository cover: ${id}`);
  const assetBytes = await readFile(path.join(root, "data", asset.key));
  const source = sourceInputs[id] || {};
  const result = buildLegacyProofAudit(record.prompt, legacyEntry, assetBytes, {
    sourceInput: source.sourceInput || "",
    sourceInputReference: source.sourceInputReference || "",
    rightsConfirmedAt: confirmedAt
  });
  record.prompt.proof = result.proof;
  const errors = validatePromptV2(record.prompt);
  if (errors.length) throw new Error(`Invalid audited prompt ${id}: ${errors.join(", ")}`);
  proofEntries[id] = manifestEntry(result.proof);
  auditEntries[id] = {
    ...result.audit,
    model: result.proof.model,
    testedAt: result.proof.testedAt,
    asset: result.proof.assets[0]
  };
  summary.total += 1;
  summary.modality[result.proof.modality] += 1;
  if (result.audit.eligibility === "human-review-ready") summary.humanReviewReady += 1;
  else summary.regenerateRequired += 1;
  for (const blocker of result.audit.blockers) summary.blockers[blocker] = (summary.blockers[blocker] || 0) + 1;
}

const outputs = {
  sourceInputs: {
    schemaVersion: 1,
    importedAt: confirmedAt,
    sourceFiles: sourceSpecs.map((item) => item.reference),
    entries: sourceInputs
  },
  manifest: {
    schemaVersion: 2,
    releaseBatch: `proof-v2-pilot-preflight-${confirmedAt}`,
    updatedAt: confirmedAt,
    entries: proofEntries
  },
  audit: {
    schemaVersion: 1,
    auditedAt: confirmedAt,
    rightsConfirmation: {
      status: "confirmed",
      basis: "repository-owner-confirmed",
      confirmedAt
    },
    summary,
    entries: auditEntries
  }
};

if (write) {
  for (const record of promptRecords.filter((item) => wantedIds.has(item.prompt.id))) {
    await writeFile(record.file, `${JSON.stringify(record.prompt, null, 2)}\n`, "utf8");
  }
  await mkdir(path.join(root, "data", "reports"), { recursive: true });
  await writeFile(path.join(root, "data", "proofs", "legacy-run-inputs.json"), `${JSON.stringify(outputs.sourceInputs, null, 2)}\n`, "utf8");
  await writeFile(path.join(root, "data", "proofs", "manifest-v2.json"), `${JSON.stringify(outputs.manifest, null, 2)}\n`, "utf8");
  await writeFile(path.join(root, "data", "reports", "legacy-proof-audit.json"), `${JSON.stringify(outputs.audit, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  mode: write ? "write" : "dry-run",
  legacyGalleryDir,
  recoveredSourceInputs: Object.keys(sourceInputs).length,
  summary
}, null, 2));
