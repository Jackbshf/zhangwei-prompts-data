import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyClassificationTaxonomy,
  buildClassificationTaxonomyReport,
  deriveClassificationTaxonomy
} from "../src/classification-taxonomy.mjs";

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

test("taxonomy maps visual, video, film, and business categories", () => {
  assert.deepEqual(deriveClassificationTaxonomy({
    category: "图像提示词 / Midjourney",
    modality: "图像",
    useCase: "电商主图"
  }), { department: "AI 视觉设计", scenario: "Midjourney", task: "电商主图" });
  assert.deepEqual(deriveClassificationTaxonomy({
    category: "视频提示词 / 即梦",
    modality: "视频",
    useCase: "产品展示"
  }), { department: "AI 视频创作", scenario: "即梦", task: "产品展示" });
  assert.deepEqual(deriveClassificationTaxonomy({
    category: "影视 / AIGC 视觉创作 / 角色定妆 / 生成服化道说明",
    modality: "图像",
    useCase: "生成服化道说明"
  }), { department: "影视创作", scenario: "角色定妆", task: "生成服化道说明" });
  assert.deepEqual(deriveClassificationTaxonomy({
    category: "品牌 / 市场 / 内容营销 / 广告语 / 生成广告语备选",
    modality: "文本",
    useCase: "生成广告语备选"
  }), { department: "品牌", scenario: "广告语", task: "生成广告语备选" });
});

test("taxonomy has a complete single-level fallback and is idempotent", () => {
  const prompt = {
    id: "fallback-001",
    classification: { category: "测试", modality: "文本", useCase: "" },
    provenance: { rightsStatus: "pending" }
  };
  const once = applyClassificationTaxonomy(prompt);
  const twice = applyClassificationTaxonomy(once);

  assert.deepEqual(once.classification, {
    category: "测试",
    modality: "文本",
    useCase: "",
    department: "测试",
    scenario: "测试",
    task: "测试"
  });
  assert.deepEqual(twice, once);
  assert.equal(twice.provenance.rightsStatus, "pending");
});

test("taxonomy report is deterministic regardless of input order", () => {
  const prompts = [
    { id: "b", classification: { category: "视频提示词 / 即梦", modality: "视频", useCase: "短片" } },
    { id: "a", classification: { category: "图像提示词 / GPT Image", modality: "图像", useCase: "海报" } }
  ];

  assert.deepEqual(
    buildClassificationTaxonomyReport(prompts),
    buildClassificationTaxonomyReport([...prompts].reverse())
  );
});

test("all canonical prompts have complete deterministic taxonomy fields", async () => {
  const files = await walkJson(fileURLToPath(new URL("../data/prompts", import.meta.url)));
  const prompts = [];
  for (const file of files) prompts.push(JSON.parse(await readFile(file, "utf8")));
  const report = buildClassificationTaxonomyReport(prompts);

  assert.equal(prompts.length, 4167);
  assert.equal(report.complete, 4167);
  assert.equal(report.incomplete, 0);
  assert.deepEqual(report.departments, {
    "AI 视觉设计": 1754,
    "AI 视频创作": 1751,
    "HR": 60,
    "产品经理": 60,
    "品牌": 60,
    "增长": 60,
    "影视创作": 180,
    "技术": 60,
    "新媒体": 62,
    "电商": 60,
    "销售": 60
  });
  for (const prompt of prompts) {
    const expected = deriveClassificationTaxonomy(prompt.classification);
    assert.deepEqual({
      department: prompt.classification.department,
      scenario: prompt.classification.scenario,
      task: prompt.classification.task
    }, expected, prompt.id);
  }
});
