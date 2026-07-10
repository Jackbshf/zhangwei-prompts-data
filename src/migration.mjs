import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { promptPathForId, toPromptV1, validatePromptV1 } from "./prompt-schema.mjs";

const dedupeModelWords = [
  "chatgpt", "gpt image", "gpt-image", "midjourney", "sora", "runway", "kling", "veo",
  "deepseek", "claude", "gemini", "通用中文", "通用图像模型", "通用视频模型",
  "閫氱敤涓枃", "閫氱敤鍥惧儚妯″瀷", "閫氱敤瑙嗛妯″瀷"
];

function clean(value) {
  return String(value ?? "").trim();
}

function promptText(indexPrompt, libraryPrompt) {
  return clean(
    libraryPrompt?.copyPrompt
    || libraryPrompt?.zhPrompt
    || libraryPrompt?.body
    || indexPrompt?.promptPreview
    || indexPrompt?.summary
  );
}

function normalizeForDedupe(value) {
  let text = clean(value).toLowerCase();
  for (const word of dedupeModelWords) text = text.split(word.toLowerCase()).join("");
  return text
    .replace(/\{[^{}]+\}/g, "{var}")
    .replace(/[，。、“”‘’：；！？（）【】《》,.;:"'!?()[\]<>/\\|·\-—_+*=#`~\s]+/g, "")
    .trim();
}

function effectSignature(indexPrompt, libraryPrompt) {
  return normalizeForDedupe([
    indexPrompt.department,
    indexPrompt.scenario,
    indexPrompt.task,
    indexPrompt.category,
    promptText(indexPrompt, libraryPrompt)
  ].filter(Boolean).join(" "));
}

export function classifyExclusion(entry, publishedIds) {
  if (!entry?.id || publishedIds.has(entry.id)) return null;
  if (entry.access !== "free") return "not-free";
  if (entry.copyReady === false) return "not-copy-ready";
  if (entry.archived) return "archived";
  return "deduplicated";
}

export function createExclusionReport(sourceEntries, publishedIds, { libraryById = new Map(), previewImages = {} } = {}) {
  const missingId = sourceEntries.find((entry) => !entry?.id);
  if (missingId) throw new Error("Legacy source record is missing id.");
  const eligible = sourceEntries.filter((entry) => entry.access === "free" && entry.copyReady !== false && !entry.archived);
  const groups = new Map();

  for (const entry of eligible) {
    const signature = effectSignature(entry, libraryById.get(entry.id));
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(entry);
  }

  const dedupeById = new Map();
  for (const [signature, group] of groups) {
    const publishedMembers = group.filter((entry) => publishedIds.has(entry.id));
    if (publishedMembers.length !== 1) {
      throw new Error(`Expected one published deduplication winner, received ${publishedMembers.length}.`);
    }
    const winner = publishedMembers[0];
    for (const entry of group) {
      if (entry.id === winner.id) continue;
      dedupeById.set(entry.id, {
        duplicateOf: winner.id,
        signatureSha256: createHash("sha256").update(signature).digest("hex")
      });
    }
  }

  const excluded = [];
  const counts = {
    "not-free": 0,
    "not-copy-ready": 0,
    archived: 0,
    deduplicated: 0
  };

  for (const entry of sourceEntries) {
    const reason = classifyExclusion(entry, publishedIds);
    if (!reason) continue;
    const dedupe = reason === "deduplicated" ? dedupeById.get(entry.id) : null;
    if (reason === "deduplicated" && (!dedupe || !publishedIds.has(dedupe.duplicateOf))) {
      throw new Error(`Cannot prove deduplication winner for ${entry.id}.`);
    }
    counts[reason] += 1;
    excluded.push({ id: entry.id, title: entry.title || "", reason, ...(dedupe || {}) });
  }

  return {
    sourceCount: sourceEntries.length,
    publicCount: publishedIds.size,
    excludedCount: excluded.length,
    counts,
    excluded
  };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function exclusionReportDigest(report) {
  return createHash("sha256").update(JSON.stringify(report)).digest("hex");
}

async function ensureMigrationTargetIsEmpty(outputRoot) {
  const dataRoot = path.join(outputRoot, "data");
  try {
    await access(dataRoot);
    throw new Error(`Migration target already exists: ${dataRoot}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function proofFilename(assetPath) {
  return path.basename(String(assetPath || ""));
}

export function collectionPathForId(id) {
  const collectionId = clean(id);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(collectionId)) {
    throw new Error(`Invalid collection id: ${collectionId || "(empty)"}`);
  }
  return `data/collections/${collectionId}.json`;
}

export async function buildExclusionReport({ legacyIndexPath, legacyLibraryPath, proofManifestPath }) {
  const [legacyIndex, legacyLibrary, proofManifest] = await Promise.all([
    readJson(legacyIndexPath),
    readJson(legacyLibraryPath),
    readJson(proofManifestPath)
  ]);
  const sourceEntries = Array.isArray(legacyIndex.prompts) ? legacyIndex.prompts : [];
  const libraryById = new Map((legacyLibrary.prompts || []).map((prompt) => [prompt.id, prompt]));
  return { sourceEntries, libraryById, previewImages: proofManifest.images || {} };
}

export async function migrateDataset({
  publicDataPath,
  legacyIndexPath,
  legacyLibraryPath,
  proofsDir,
  proofManifestPath,
  outputRoot
}) {
  await ensureMigrationTargetIsEmpty(outputRoot);
  const stageRoot = path.join(outputRoot, `.migration-stage-${process.pid}-${Date.now()}`);
  try {
    const summary = await migrateIntoStage({
      publicDataPath,
      legacyIndexPath,
      legacyLibraryPath,
      proofsDir,
      proofManifestPath,
      outputRoot: stageRoot
    });
    await mkdir(outputRoot, { recursive: true });
    await rename(path.join(stageRoot, "data"), path.join(outputRoot, "data"));
    await rm(stageRoot, { recursive: true, force: true });
    return summary;
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

async function migrateIntoStage({
  publicDataPath,
  legacyIndexPath,
  legacyLibraryPath,
  proofsDir,
  proofManifestPath,
  outputRoot
}) {
  const [publicPayload, proofManifest, exclusionInputs] = await Promise.all([
    readJson(publicDataPath),
    readJson(proofManifestPath),
    buildExclusionReport({ legacyIndexPath, legacyLibraryPath, proofManifestPath })
  ]);
  const publicPrompts = Array.isArray(publicPayload.prompts) ? publicPayload.prompts : [];
  const publishedIds = new Set(publicPrompts.map((prompt) => prompt.id));
  const exclusionReport = createExclusionReport(exclusionInputs.sourceEntries, publishedIds, exclusionInputs);

  for (const sourcePrompt of publicPrompts) {
    const prompt = toPromptV1(sourcePrompt);
    const errors = validatePromptV1(prompt);
    if (errors.length) {
      throw new Error(`Prompt ${prompt.id || "(missing id)"} is invalid: ${errors.join(", ")}`);
    }
    await writeJson(path.join(outputRoot, promptPathForId(prompt.id)), prompt);
  }

  const collections = Array.isArray(publicPayload.collections) ? publicPayload.collections : [];
  for (const collection of collections) {
    if (!collection?.id) throw new Error("Collection id is required.");
    await writeJson(path.join(outputRoot, collectionPathForId(collection.id)), {
      schemaVersion: 1,
      ...collection
    });
  }

  const proofPrompts = publicPrompts.filter((prompt) => prompt.coverImageUrl && prompt.commercialProof);
  for (const prompt of proofPrompts) {
    const filename = proofFilename(prompt.coverImageUrl);
    await mkdir(path.join(outputRoot, "data", "proofs", "generated"), { recursive: true });
    await copyFile(
      path.join(proofsDir, filename),
      path.join(outputRoot, "data", "proofs", "generated", filename)
    );
  }
  await writeJson(path.join(outputRoot, "data", "proofs", "manifest.json"), proofManifest);
  const exclusionText = serializeJson(exclusionReport);
  const exclusionPath = path.join(outputRoot, "data", "reports", "migration-exclusions.json");
  await mkdir(path.dirname(exclusionPath), { recursive: true });
  await writeFile(exclusionPath, exclusionText, "utf8");

  const summary = {
    prompts: publicPrompts.length,
    collections: collections.length,
    proofs: proofPrompts.length,
    excluded: exclusionReport.excludedCount
  };
  await writeJson(path.join(outputRoot, "data", "reports", "migration-summary.json"), {
    sourceGeneratedAt: publicPayload.generatedAt || "",
    ...summary,
    exclusionReportSha256: exclusionReportDigest(exclusionReport)
  });
  return summary;
}
