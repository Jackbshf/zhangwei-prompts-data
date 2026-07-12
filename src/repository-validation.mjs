import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { promptPathForId, validatePromptV1 } from "./prompt-schema.mjs";
import { validatePromptV2 } from "./prompt-schema-v2.mjs";
import { exclusionReportDigest } from "./migration.mjs";

const secretPattern = /((^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}|(^|[^A-Za-z0-9_])gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|https?:\/\/[^\s/:]+:[^\s/@]+@|-----BEGIN (RSA |OPENSSH |EC |)PRIVATE KEY-----)/;

async function walk(dir, predicate = () => true) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full, predicate));
    else if (predicate(full)) files.push(full);
  }
  return files;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function assertExpected(label, actual, expected) {
  if (expected !== undefined && actual !== expected) {
    throw new Error(`${label} count mismatch: expected ${expected}, received ${actual}`);
  }
}

export async function validateRepository(root, expected = {}) {
  const promptRoot = path.join(root, "data", "prompts");
  const collectionRoot = path.join(root, "data", "collections");
  const proofRoot = path.join(root, "data", "proofs", "generated");
  const promptFiles = await walk(promptRoot, (file) => file.endsWith(".json"));
  const collectionFiles = await walk(collectionRoot, (file) => file.endsWith(".json"));
  const proofFiles = await readdir(proofRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const ids = new Set();
  const promptById = new Map();
  const collectionIds = new Set();
  const prompts = [];

  for (const file of collectionFiles) {
    const collection = await readJson(file);
    if (!collection.id || collection.schemaVersion !== 1) {
      throw new Error(`Invalid collection: ${path.relative(root, file)}`);
    }
    collectionIds.add(collection.id);
  }

  for (const file of promptFiles) {
    const prompt = await readJson(file);
    const errors = prompt.schemaVersion === 2 ? validatePromptV2(prompt) : validatePromptV1(prompt);
    if (errors.length) throw new Error(`Invalid prompt ${prompt.id || "(missing)"}: ${errors.join(", ")}`);
    if (ids.has(prompt.id)) throw new Error(`Duplicate prompt id: ${prompt.id}`);
    ids.add(prompt.id);
    promptById.set(prompt.id, prompt);
    prompts.push(prompt);

    const actual = path.relative(root, file).replaceAll("\\", "/");
    const expectedPath = promptPathForId(prompt.id);
    if (actual !== expectedPath) {
      throw new Error(`Prompt path mismatch for ${prompt.id}: expected ${expectedPath}, received ${actual}`);
    }
    for (const collectionId of prompt.publication.collectionIds) {
      if (!collectionIds.has(collectionId)) throw new Error(`Prompt ${prompt.id} references unknown collection ${collectionId}`);
    }
    if (prompt.proof && prompt.schemaVersion === 1) {
      await access(path.join(root, "data", prompt.proof.assetPath)).catch(() => {
        throw new Error(`Prompt ${prompt.id} references missing proof ${prompt.proof.assetPath}`);
      });
    }
    if (prompt.proof && prompt.schemaVersion === 2) {
      for (const asset of prompt.proof.assets.filter((item) => item.storage === "repository")) {
        await access(path.join(root, "data", asset.key)).catch(() => {
          throw new Error(`Prompt ${prompt.id} references missing proof ${asset.key}`);
        });
      }
    }
  }

  const exclusionPath = path.join(root, "data", "reports", "migration-exclusions.json");
  const exclusionText = await readFile(exclusionPath, "utf8");
  const exclusionReport = JSON.parse(exclusionText);
  const migrationSummary = await readJson(path.join(root, "data", "reports", "migration-summary.json"));
  const exclusionDigest = exclusionReportDigest(exclusionReport);
  if (migrationSummary.exclusionReportSha256 !== exclusionDigest) {
    throw new Error("Migration exclusion report digest mismatch.");
  }
  if (exclusionReport.excludedCount !== exclusionReport.excluded?.length) {
    throw new Error("Migration exclusion report count mismatch.");
  }
  const exclusionCountTotal = Object.values(exclusionReport.counts || {}).reduce((sum, count) => sum + Number(count || 0), 0);
  if (exclusionCountTotal !== exclusionReport.excludedCount) {
    throw new Error("Migration exclusion reason counts do not add up.");
  }
  if (exclusionReport.publicCount !== ids.size || exclusionReport.sourceCount !== ids.size + exclusionReport.excludedCount) {
    throw new Error("Migration exclusion source/public counts do not close.");
  }
  const excludedIds = new Set();
  const allowedReasons = new Set(["not-free", "not-copy-ready", "archived", "deduplicated"]);
  const actualReasonCounts = Object.fromEntries([...allowedReasons].map((reason) => [reason, 0]));
  for (const item of exclusionReport.excluded || []) {
    if (!item.id || excludedIds.has(item.id) || ids.has(item.id)) {
      throw new Error(`Invalid exclusion id: ${item.id || "(missing id)"}`);
    }
    excludedIds.add(item.id);
    if (!allowedReasons.has(item.reason)) throw new Error(`Invalid exclusion reason for ${item.id}: ${item.reason}`);
    actualReasonCounts[item.reason] += 1;
    if (item.reason !== "deduplicated") continue;
    const validWinner = item.duplicateOf && item.duplicateOf !== item.id && ids.has(item.duplicateOf);
    const validSignature = /^[0-9a-f]{64}$/.test(String(item.signatureSha256 || ""));
    if (!validWinner || !validSignature) {
      throw new Error(`Invalid deduplication evidence for ${item.id || "(missing id)"}.`);
    }
  }
  for (const reason of allowedReasons) {
    if (Number(exclusionReport.counts?.[reason] || 0) !== actualReasonCounts[reason]) {
      throw new Error(`Migration exclusion reason count mismatch for ${reason}.`);
    }
  }

  const proofManifest = await readJson(path.join(root, "data", "proofs", "manifest.json"));
  const manifestImages = proofManifest.images && typeof proofManifest.images === "object" ? proofManifest.images : {};
  const manifestFilenames = new Set();
  for (const [id, entry] of Object.entries(manifestImages)) {
    const prompt = promptById.get(id);
    if (!prompt?.proof) throw new Error(`Orphan proof manifest entry: ${id}`);
    const legacyAsset = prompt.schemaVersion === 2
      ? prompt.proof.assets.find((asset) => asset.storage === "repository" && asset.role === "cover")
      : null;
    const assetPath = legacyAsset?.key || prompt.proof.assetPath;
    const filename = path.basename(assetPath);
    const expectedUrl = legacyAsset?.url || `/prompts/${assetPath}`;
    if (entry.coverImageUrl !== expectedUrl) throw new Error(`Proof manifest URL mismatch for ${id}`);
    if (entry.promptId && entry.promptId !== id) throw new Error(`Proof manifest promptId mismatch for ${id}`);
    manifestFilenames.add(filename);
  }
  for (const prompt of prompts.filter((item) => item.proof)) {
    const hasLegacyRepositoryCover = prompt.schemaVersion === 1
      || prompt.proof.assets.some((asset) => asset.storage === "repository" && asset.role === "cover");
    if (hasLegacyRepositoryCover && !manifestImages[prompt.id]) throw new Error(`Proof prompt missing manifest entry: ${prompt.id}`);
  }
  for (const entry of proofFiles.filter((item) => item.isFile() && item.name.endsWith(".webp"))) {
    if (!manifestFilenames.has(entry.name)) throw new Error(`Orphan proof file: ${entry.name}`);
  }

  const v2Prompts = prompts.filter((prompt) => prompt.schemaVersion === 2 && prompt.proof);
  const manifestV2Path = path.join(root, "data", "proofs", "manifest-v2.json");
  if (v2Prompts.length && !await exists(manifestV2Path)) throw new Error("Schema v2 proofs require data/proofs/manifest-v2.json");
  if (await exists(manifestV2Path)) {
    const manifestV2 = await readJson(manifestV2Path);
    const entries = manifestV2.entries && typeof manifestV2.entries === "object" ? manifestV2.entries : {};
    for (const [id, entry] of Object.entries(entries)) {
      const prompt = promptById.get(id);
      if (!prompt?.proof || prompt.schemaVersion !== 2) throw new Error(`Orphan Schema v2 proof manifest entry: ${id}`);
      if (entry.status !== prompt.proof.status || entry.modality !== prompt.proof.modality) {
        throw new Error(`Schema v2 proof manifest metadata mismatch for ${id}`);
      }
      const expectedAssets = JSON.stringify(prompt.proof.assets);
      if (JSON.stringify(entry.assets) !== expectedAssets) throw new Error(`Schema v2 proof manifest assets mismatch for ${id}`);
    }
    for (const prompt of v2Prompts) {
      if (!entries[prompt.id]) throw new Error(`Schema v2 proof missing manifest entry: ${prompt.id}`);
    }
  }

  const textFiles = [
    ...promptFiles,
    ...collectionFiles,
    path.join(root, "data", "proofs", "manifest.json"),
    path.join(root, "data", "reports", "migration-exclusions.json")
  ];
  if (await exists(manifestV2Path)) textFiles.push(manifestV2Path);
  for (const file of textFiles) {
    const text = await readFile(file, "utf8");
    if (secretPattern.test(text)) throw new Error(`Potential secret detected in ${path.relative(root, file)}`);
  }

  const proofCount = proofFiles.filter((entry) => entry.isFile() && entry.name.endsWith(".webp")).length;
  const result = {
    prompts: prompts.length,
    collections: collectionIds.size,
    proofs: proofCount,
    excluded: exclusionReport.excludedCount
  };
  assertExpected("Prompt", result.prompts, expected.expectedPrompts);
  assertExpected("Collection", result.collections, expected.expectedCollections);
  assertExpected("Proof", result.proofs, expected.expectedProofs);
  assertExpected("Excluded", result.excluded, expected.expectedExcluded);
  return result;
}
