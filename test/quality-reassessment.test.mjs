import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { QUALITY_RUBRIC_VERSION } from "../src/quality-audit.mjs";
import { reassessPromptRepositoryQuality } from "../src/quality-reassessment.mjs";
import { promptPathForId } from "../src/prompt-schema.mjs";
import { toPromptV2 } from "../src/prompt-schema-v2.mjs";

async function writePrompt(root, id, overrides = {}) {
  const prompt = toPromptV2({
    id,
    title: "电商产品主图生成提示词",
    category: "电商视觉",
    summary: "为中文电商详情页生成具有明确构图、光线和材质要求的产品主图。",
    prompt: "你是一名电商视觉导演。请根据{{产品}}和{{受众}}生成可直接执行的主图提示词，必须说明主体、场景、构图、镜头、光线、材质、色彩、画幅和负面约束，并给出质量检查清单，避免品牌、水印和随机文字。",
    variables: ["{产品}", "{受众}"],
    variableDefaults: { 产品: "无品牌玻璃香氛瓶", 受众: "城市白领" },
    tool: "GPT Image",
    model: "gpt-image",
    modality: "图像",
    task: "电商产品主图",
    source: "站内原创生成种子，不复制外部提示词原文",
    copyReady: true,
    ...overrides
  });
  prompt.provenance.rightsStatus = "confirmed";
  const file = path.join(root, promptPathForId(id));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(prompt, null, 2)}\n`, "utf8");
  return file;
}

test("quality reassessment supports dry-run and writes a deterministic summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prompt-quality-v3-"));
  const file = await writePrompt(root, "quality-v3-image-001");
  const before = await readFile(file, "utf8");

  const preview = await reassessPromptRepositoryQuality(root, { checkedAt: "2026-07-18", dryRun: true });
  assert.equal(preview.total, 1);
  assert.equal(preview.changed, 1);
  assert.equal(await readFile(file, "utf8"), before);

  const applied = await reassessPromptRepositoryQuality(root, { checkedAt: "2026-07-18" });
  const stored = JSON.parse(await readFile(file, "utf8"));
  const report = JSON.parse(await readFile(path.join(root, "data/reports/quality-v3-summary.json"), "utf8"));
  const { changed: _changed, ...expectedReport } = applied;
  assert.equal(stored.publication.qualityAssessment.rubricVersion, QUALITY_RUBRIC_VERSION);
  assert.equal(stored.publication.qualityScore, stored.publication.qualityAssessment.score);
  assert.deepEqual(report, expectedReport);
});
