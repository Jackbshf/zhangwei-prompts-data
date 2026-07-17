import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migratePromptRepositoryToV2 } from "../src/schema-v2-migration.mjs";
import { QUALITY_RUBRIC_VERSION } from "../src/quality-audit.mjs";
import { promptPathForId, toPromptV1 } from "../src/prompt-schema.mjs";

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("repository migration upgrades records and fingerprints legacy proof assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prompt-v2-migration-"));
  const id = "migration-v2-image";
  const prompt = toPromptV1({
    id,
    title: "电商产品主图生成提示词",
    category: "电商视觉",
    summary: "为中文电商详情页生成具有明确构图、光线和材质要求的产品主图。",
    prompt: "你是一名电商视觉导演。请根据产品和受众生成可直接执行的主图提示词，必须说明主体、场景、构图、镜头、光线、材质、色彩、画幅和负面约束，并给出检查清单。",
    tool: "GPT Image",
    modality: "图像",
    source: "站内原创生成种子，不复制外部提示词原文",
    copyReady: true,
    coverImageUrl: `/prompts/proofs/generated/${id}.webp`,
    commercialProof: {
      type: "生成预览",
      model: "GPT Image",
      testedAt: "2026-07-05",
      resultNote: "旧版预览",
      evidenceLevel: "generated-preview"
    }
  });
  await writeJson(path.join(root, promptPathForId(id)), prompt);
  await mkdir(path.join(root, "data/proofs/generated"), { recursive: true });
  await writeFile(path.join(root, `data/proofs/generated/${id}.webp`), "proof-bytes");

  const result = await migratePromptRepositoryToV2(root, { checkedAt: "2026-07-12" });
  const migrated = JSON.parse(await readFile(path.join(root, promptPathForId(id)), "utf8"));
  const qualitySummary = JSON.parse(await readFile(path.join(root, "data/reports/quality-v2-summary.json"), "utf8"));

  assert.deepEqual(result, { prompts: 1, proofPreviews: 1, qualityPassed: 1, qualityFailed: 0 });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.proof.assets[0].bytes, 11);
  assert.match(migrated.proof.assets[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(migrated.publication.qualityAssessment.status, "passed");
  assert.deepEqual(qualitySummary, {
    rubricVersion: QUALITY_RUBRIC_VERSION,
    checkedAt: "2026-07-12",
    total: 1,
    passed: 1,
    failed: 0,
    issueCounts: {}
  });
});
