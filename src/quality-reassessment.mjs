import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { assessPromptQuality, QUALITY_RUBRIC_VERSION, qualityLevelForAssessment } from "./quality-audit.mjs";
import { validatePromptV2 } from "./prompt-schema-v2.mjs";

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

function distributionSummary(distribution) {
  const entries = [...distribution.entries()].sort((a, b) => a[0] - b[0]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const dominant = entries.reduce((best, entry) => entry[1] > best[1] ? entry : best, [0, 0]);
  const weighted = entries.reduce((sum, [score, count]) => sum + score * count, 0);
  return {
    minScore: entries[0]?.[0] ?? 0,
    maxScore: entries.at(-1)?.[0] ?? 0,
    averageScore: total ? Number((weighted / total).toFixed(2)) : 0,
    uniqueScoreCount: entries.length,
    dominantScore: dominant[0],
    dominantCount: dominant[1],
    dominantRatio: total ? Number((dominant[1] / total).toFixed(6)) : 0,
    scoreDistribution: Object.fromEntries(entries)
  };
}

export async function reassessPromptRepositoryQuality(root, options = {}) {
  const checkedAt = String(options.checkedAt || "").trim();
  const dryRun = options.dryRun === true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) throw new Error("checkedAt must use YYYY-MM-DD.");

  const files = await walkJson(path.join(root, "data", "prompts"));
  const distribution = new Map();
  const byModality = {};
  const issueCounts = {};
  let passed = 0;
  let failed = 0;
  let changed = 0;

  for (const file of files) {
    const prompt = JSON.parse(await readFile(file, "utf8"));
    if (prompt.schemaVersion !== 2) throw new Error(`Quality reassessment requires Schema v2: ${prompt.id || file}`);
    const assessment = assessPromptQuality(prompt, { checkedAt });
    const nextLevel = qualityLevelForAssessment(assessment);
    const before = JSON.stringify({
      qualityScore: prompt.publication.qualityScore,
      qualityLevel: prompt.publication.qualityLevel,
      qualityAssessment: prompt.publication.qualityAssessment
    });
    prompt.publication.qualityScore = assessment.score;
    prompt.publication.qualityLevel = nextLevel;
    prompt.publication.qualityAssessment = assessment;
    const after = JSON.stringify({
      qualityScore: prompt.publication.qualityScore,
      qualityLevel: prompt.publication.qualityLevel,
      qualityAssessment: prompt.publication.qualityAssessment
    });
    if (before !== after) changed += 1;

    const errors = validatePromptV2(prompt);
    if (errors.length) throw new Error(`Invalid reassessed prompt ${prompt.id}: ${errors.join(", ")}`);
    if (!dryRun && before !== after) await writeFile(file, `${JSON.stringify(prompt, null, 2)}\n`, "utf8");

    distribution.set(assessment.score, (distribution.get(assessment.score) || 0) + 1);
    const modality = String(prompt.classification?.modality || "unknown");
    const bucket = byModality[modality] || { total: 0, passed: 0, failed: 0, minScore: 100, maxScore: 0 };
    bucket.total += 1;
    bucket[assessment.status] += 1;
    bucket.minScore = Math.min(bucket.minScore, assessment.score);
    bucket.maxScore = Math.max(bucket.maxScore, assessment.score);
    byModality[modality] = bucket;
    if (assessment.status === "passed") passed += 1;
    else failed += 1;
    for (const issue of assessment.issues) issueCounts[issue] = (issueCounts[issue] || 0) + 1;
  }

  const summary = {
    rubricVersion: QUALITY_RUBRIC_VERSION,
    checkedAt,
    total: files.length,
    passed,
    failed,
    changed,
    ...distributionSummary(distribution),
    byModality,
    issueCounts
  };
  if (!dryRun) {
    const reportsDir = path.join(root, "data", "reports");
    const { changed: _changed, ...report } = summary;
    await mkdir(reportsDir, { recursive: true });
    await writeFile(path.join(reportsDir, "quality-v3-summary.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return summary;
}
