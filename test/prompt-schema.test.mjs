import test from "node:test";
import assert from "node:assert/strict";

import {
  promptPathForId,
  toPromptV1,
  validatePromptV1
} from "../src/prompt-schema.mjs";

const legacyPrompt = {
  id: "cinematic-test-001",
  title: "电影感人物肖像",
  category: "影视提示词 / 单人图片",
  summary: "可复制的电影感人物肖像模板。",
  prompt: "生成一张电影感人物肖像。",
  preview: "电影感人物肖像",
  variables: ["{subject}"],
  variableDefaults: { subject: "年轻导演" },
  tool: "通用中文",
  model: "universal",
  modality: "图像",
  language: "zh-CN",
  qualityScore: 92,
  qualityLevel: "usable",
  featured: true,
  copyReady: true,
  tags: ["电影感"],
  seoKeywords: ["肖像"],
  aspectRatio: "9:16",
  use: "单人肖像",
  difficulty: "进阶",
  verifiedAt: "2026-05-24",
  source: "原创",
  styleTags: ["电影胶片"],
  collectionIds: ["cinematic-single-shot"],
  coverImageUrl: "/prompts/proofs/generated/cinematic-test-001.webp",
  commercialProof: {
    type: "生成预览",
    model: "GPT Image",
    testedAt: "2026-05-24",
    resultNote: "与提示词 ID 对应。",
    evidenceLevel: "generated-preview"
  }
};

test("promptPathForId creates a deterministic two-character shard", () => {
  const first = promptPathForId(legacyPrompt.id);
  const second = promptPathForId(legacyPrompt.id);

  assert.equal(first, second);
  assert.match(first, /^data\/prompts\/[0-9a-f]{2}\/cinematic-test-001\.json$/);
});

test("toPromptV1 preserves public content in grouped schema fields", () => {
  const prompt = toPromptV1(legacyPrompt);

  assert.equal(prompt.schemaVersion, 1);
  assert.equal(prompt.content.title, legacyPrompt.title);
  assert.equal(prompt.content.prompt, legacyPrompt.prompt);
  assert.equal(prompt.classification.modality, "图像");
  assert.deepEqual(prompt.variables.defaults, { subject: "年轻导演" });
  assert.equal(prompt.proof.assetPath, "proofs/generated/cinematic-test-001.webp");
  assert.equal(prompt.publication.status, "published-proofed");
  assert.deepEqual(validatePromptV1(prompt), []);
});

test("validatePromptV1 rejects incomplete proof metadata", () => {
  const prompt = toPromptV1(legacyPrompt);
  prompt.proof.testedAt = "";

  assert.deepEqual(validatePromptV1(prompt), ["proof.testedAt"]);
});

test("validatePromptV1 enforces the published JSON Schema contract", () => {
  const invalidModality = toPromptV1(legacyPrompt);
  invalidModality.classification.modality = "audio";
  assert.ok(validatePromptV1(invalidModality).includes("classification.modality"));

  const invalidScore = toPromptV1(legacyPrompt);
  invalidScore.publication.qualityScore = 999;
  assert.ok(validatePromptV1(invalidScore).includes("publication.qualityScore"));

  const tooManyVariables = toPromptV1(legacyPrompt);
  tooManyVariables.variables.names = Array.from({ length: 25 }, (_, index) => `{v${index}}`);
  assert.ok(validatePromptV1(tooManyVariables).includes("variables.names"));

  const extraProperty = { ...toPromptV1(legacyPrompt), unexpected: true };
  assert.ok(validatePromptV1(extraProperty).includes("unexpected"));

  const unsafeProofPath = toPromptV1(legacyPrompt);
  unsafeProofPath.proof.assetPath = "proofs/generated/..\\..\\private.webp";
  assert.ok(validatePromptV1(unsafeProofPath).includes("proof.assetPath"));
});
