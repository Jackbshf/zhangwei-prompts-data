import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { assessPromptQuality, QUALITY_RUBRIC_VERSION, qualityLevelForAssessment, reconcileVariableDeclarations } from "./quality-audit.mjs";
import { toPromptV2, validatePromptV2 } from "./prompt-schema-v2.mjs";

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

async function fingerprintRepositoryAssets(root, prompt) {
  if (!prompt.proof) return prompt;
  for (const asset of prompt.proof.assets) {
    if (asset.storage !== "repository") continue;
    const file = path.join(root, "data", asset.key);
    const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
    asset.sha256 = createHash("sha256").update(bytes).digest("hex");
    asset.bytes = info.size;
  }
  return prompt;
}

export async function migratePromptRepositoryToV2(root, options = {}) {
  const checkedAt = String(options.checkedAt || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) throw new Error("checkedAt must use YYYY-MM-DD.");
  const files = await walkJson(path.join(root, "data", "prompts"));
  let proofPreviews = 0;
  let qualityPassed = 0;
  let qualityFailed = 0;
  const proofEntries = {};
  const issueCounts = {};

  for (const file of files) {
    const source = JSON.parse(await readFile(file, "utf8"));
    const prompt = source.schemaVersion === 2 ? source : toPromptV2(source);
    await fingerprintRepositoryAssets(root, prompt);
    reconcileVariableDeclarations(prompt);
    const assessment = assessPromptQuality(prompt, { checkedAt });
    prompt.publication.qualityAssessment = assessment;
    prompt.publication.qualityScore = assessment.score;
    prompt.publication.qualityLevel = qualityLevelForAssessment(assessment);
    if (prompt.proof?.status === "preview") proofPreviews += 1;
    if (prompt.proof) {
      proofEntries[prompt.id] = {
        status: prompt.proof.status,
        modality: prompt.proof.modality,
        provider: prompt.proof.provider,
        model: prompt.proof.model,
        testedAt: prompt.proof.testedAt,
        evidenceLevel: prompt.proof.evidenceLevel,
        rights: prompt.proof.rights,
        assets: prompt.proof.assets,
        run: prompt.proof.run,
        qa: prompt.proof.qa
      };
    }
    if (assessment.status === "passed") qualityPassed += 1;
    else qualityFailed += 1;
    for (const issue of assessment.issues) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
    const errors = validatePromptV2(prompt);
    if (errors.length) throw new Error(`Invalid migrated prompt ${prompt.id}: ${errors.join(", ")}`);
    await writeFile(file, `${JSON.stringify(prompt, null, 2)}\n`, "utf8");
  }
  await writeFile(path.join(root, "data", "proofs", "manifest-v2.json"), `${JSON.stringify({
    schemaVersion: 2,
    releaseBatch: `schema-v2-migration-${checkedAt}`,
    updatedAt: checkedAt,
    entries: proofEntries
  }, null, 2)}\n`, "utf8");
  const reportsDir = path.join(root, "data", "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeFile(path.join(reportsDir, "quality-v2-summary.json"), `${JSON.stringify({
    rubricVersion: QUALITY_RUBRIC_VERSION,
    checkedAt,
    total: files.length,
    passed: qualityPassed,
    failed: qualityFailed,
    issueCounts
  }, null, 2)}\n`, "utf8");
  return { prompts: files.length, proofPreviews, qualityPassed, qualityFailed };
}
