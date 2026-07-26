import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { promptPathForId, validatePromptV1 } from "./prompt-schema.mjs";
import { exclusionReportDigest } from "./migration.mjs";

const secretPattern = /((^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}|(^|[^A-Za-z0-9_])gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|https?:\/\/[^\s/:]+:[^\s/@]+@|-----BEGIN (RSA |OPENSSH |EC |)PRIVATE KEY-----)/;
const PUBLIC_STATUSES = new Set(["published", "published-no-image", "published-proofed"]);

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
  const collections = [];
  const prompts = [];

  for (const file of collectionFiles) {
    const collection = await readJson(file);
    if (!collection.id || collection.schemaVersion !== 1) {
      throw new Error(`Invalid collection: ${path.relative(root, file)}`);
    }
    collectionIds.add(collection.id);
    collections.push(collection);
  }

  for (const file of promptFiles) {
    const prompt = await readJson(file);
    const errors = validatePromptV1(prompt);
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
    if (prompt.proof) {
      await access(path.join(root, "data", prompt.proof.assetPath)).catch(() => {
        throw new Error(`Prompt ${prompt.id} references missing proof ${prompt.proof.assetPath}`);
      });
    }
  }

  for (const collection of collections) {
    if (!Object.hasOwn(collection, "promptIds")) continue;
    const promptIds = Array.isArray(collection.promptIds) ? collection.promptIds : [];
    if (!promptIds.length || new Set(promptIds).size !== promptIds.length) {
      throw new Error(`Collection ${collection.id} must define unique promptIds.`);
    }
    for (const id of promptIds) {
      const prompt = promptById.get(id);
      if (!prompt || !PUBLIC_STATUSES.has(prompt.publication.status) || prompt.publication.copyReady === false) {
        throw new Error(`Collection ${collection.id} references an unavailable prompt: ${id}`);
      }
    }
    const sampleIds = (collection.samplePrompts || []).map((item) => item.id);
    if (sampleIds.some((id) => !promptIds.includes(id))) {
      throw new Error(`Collection ${collection.id} contains a sample outside promptIds.`);
    }
    if (collection.promptCount !== promptIds.length) {
      throw new Error(`Collection ${collection.id} promptCount mismatch.`);
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
    const filename = path.basename(prompt.proof.assetPath);
    const expectedUrl = `/prompts/${prompt.proof.assetPath}`;
    if (entry.coverImageUrl !== expectedUrl) throw new Error(`Proof manifest URL mismatch for ${id}`);
    if (entry.promptId && entry.promptId !== id) throw new Error(`Proof manifest promptId mismatch for ${id}`);
    manifestFilenames.add(filename);
  }
  for (const prompt of prompts.filter((item) => item.proof)) {
    if (!manifestImages[prompt.id]) throw new Error(`Proof prompt missing manifest entry: ${prompt.id}`);
  }
  for (const entry of proofFiles.filter((item) => item.isFile() && item.name.endsWith(".webp"))) {
    if (!manifestFilenames.has(entry.name)) throw new Error(`Orphan proof file: ${entry.name}`);
  }

  const textFiles = [
    ...promptFiles,
    ...collectionFiles,
    path.join(root, "data", "proofs", "manifest.json"),
    path.join(root, "data", "reports", "migration-exclusions.json")
  ];
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
