import test from "node:test";
import assert from "node:assert/strict";

import { assessPromptQuality, QUALITY_RUBRIC_VERSION, qualityLevelForAssessment, reconcileVariableDeclarations } from "../src/quality-audit.mjs";
import { toPromptV2 } from "../src/prompt-schema-v2.mjs";

function prompt(overrides = {}) {
  return toPromptV2({
    id: "quality-audit-001",
    title: "电商产品主图生成提示词",
    category: "电商视觉",
    summary: "为中文电商详情页生成具有明确构图、光线和材质要求的产品主图。",
    prompt: "你是一名电商视觉导演。请根据{{产品}}和{{受众}}生成可直接执行的主图提示词，必须说明主体、场景、构图、镜头、光线、材质、色彩、画幅和负面约束，并给出检查清单。",
    variables: ["{产品}", "{受众}"],
    tool: "GPT Image",
    model: "gpt-image",
    modality: "图像",
    source: "站内原创生成种子，不复制外部提示词原文",
    copyReady: true,
    ...overrides
  });
}

test("quality audit passes a concrete copy-ready prompt", () => {
  const result = assessPromptQuality(prompt(), { checkedAt: "2026-07-12" });

  assert.equal(result.status, "passed");
  assert.ok(result.score >= 85);
  assert.ok(result.score < 100);
  assert.equal(result.rubricVersion, QUALITY_RUBRIC_VERSION);
  assert.match(qualityLevelForAssessment(result), /^quality-v3-/);
  assert.deepEqual(result.issues, []);
  assert.equal(result.checkedAt, "2026-07-12");
});

test("quality audit rewards usable defaults and confirmed rights without changing proof state", () => {
  const pending = prompt();
  const stronger = prompt();
  stronger.variables.defaults = { 产品: "无品牌玻璃香氛瓶", 受众: "城市白领" };
  stronger.provenance.rightsStatus = "confirmed";

  const pendingResult = assessPromptQuality(pending, { checkedAt: "2026-07-18" });
  const strongerResult = assessPromptQuality(stronger, { checkedAt: "2026-07-18" });

  assert.ok(strongerResult.score > pendingResult.score);
  assert.equal(stronger.proof, null);
});

test("quality audit detects a modality and tool mismatch", () => {
  const matched = prompt({ tool: "GPT Image", model: "gpt-image", modality: "图像" });
  const mismatched = prompt({ tool: "Google Veo", model: "veo", modality: "图像" });

  assert.ok(
    assessPromptQuality(matched, { checkedAt: "2026-07-18" }).score
      > assessPromptQuality(mismatched, { checkedAt: "2026-07-18" }).score
  );
});

test("quality audit rejects generic and unresolved prompt content", () => {
  const weak = prompt({
    title: "提示词",
    summary: "帮我优化。",
    prompt: "请生成内容。",
    variables: ["{产品}"],
    source: ""
  });
  weak.content.prompt = "请生成{{缺失变量}}。";
  weak.provenance.source = "unknown";

  const result = assessPromptQuality(weak, { checkedAt: "2026-07-12" });

  assert.equal(result.status, "failed");
  assert.ok(result.score < 85);
  assert.ok(result.issues.includes("content.prompt.too-short"));
  assert.ok(result.issues.includes("variables.unresolved"));
  assert.ok(result.issues.includes("provenance.source.unusable"));
});

test("variable reconciliation declares referenced variables with safe defaults", () => {
  const value = prompt();
  value.content.prompt += " 画幅使用{{画面比例}}。";
  value.classification.aspectRatio = "4:3";

  reconcileVariableDeclarations(value);

  assert.ok(value.variables.names.includes("{画面比例}"));
  assert.equal(value.variables.defaults["画面比例"], "4:3");
  assert.equal(assessPromptQuality(value, { checkedAt: "2026-07-12" }).status, "passed");
});
