import test from "node:test";
import assert from "node:assert/strict";

import {
  fromPromptV2,
  toPromptV2,
  validatePromptV2
} from "../src/prompt-schema-v2.mjs";
import { toPromptV1 } from "../src/prompt-schema.mjs";

function legacyPrompt(modality = "图像") {
  return toPromptV1({
    id: `proof-v2-${modality === "图像" ? "image" : modality === "视频" ? "video" : "text"}`,
    title: "Schema v2 测试提示词",
    category: "测试",
    summary: "用于验证 Schema v2 迁移。",
    prompt: "生成一个可验证的结果。",
    tool: "测试模型",
    model: "test-model",
    modality,
    source: "站内原创测试",
    copyReady: true,
    qualityScore: 98,
    coverImageUrl: `/prompts/proofs/generated/proof-v2-${modality === "图像" ? "image" : modality === "视频" ? "video" : "text"}.webp`,
    commercialProof: {
      type: "GPT Image 效果预览",
      model: "ChatGPT web / GPT Image",
      testedAt: "2026-07-05",
      resultNote: "旧版生成预览。",
      evidenceLevel: "generated-preview"
    }
  });
}

test("toPromptV2 preserves ids and reclassifies legacy proof as preview", () => {
  const prompt = toPromptV2(legacyPrompt("视频"));

  assert.equal(prompt.schemaVersion, 2);
  assert.equal(prompt.id, "proof-v2-video");
  assert.equal(prompt.proof.status, "preview");
  assert.equal(prompt.proof.modality, "video");
  assert.equal(prompt.proof.assets[0].role, "cover");
  assert.equal(prompt.proof.assets[0].storage, "repository");
  assert.equal(prompt.proof.rights.status, "pending");
  assert.equal(prompt.publication.qualityAssessment.status, "pending");
  assert.equal(prompt.provenance.rightsStatus, "pending");
  assert.deepEqual(validatePromptV2(prompt), []);
});

test("validatePromptV2 requires complete evidence for verified results", () => {
  const prompt = toPromptV2(legacyPrompt("图像"));
  prompt.proof.status = "run-verified";

  const fields = validatePromptV2(prompt);
  assert.ok(fields.includes("proof.assets.primary"));
  assert.ok(fields.includes("proof.run.inputSha256"));
  assert.ok(fields.includes("proof.run.outputSha256"));
  assert.ok(fields.includes("proof.qa.automatedStatus"));
  assert.ok(fields.includes("proof.rights.status"));
});

test("validatePromptV2 rejects verified proof below the commercial quality threshold", () => {
  const prompt = toPromptV2(legacyPrompt("图像"));
  prompt.proof.status = "run-verified";
  prompt.proof.rights.status = "confirmed";
  prompt.publication.qualityScore = 84;

  assert.ok(validatePromptV2(prompt).includes("publication.qualityScore"));
});

test("validatePromptV2 only permits repository-hosted proof assets", () => {
  const prompt = toPromptV2(legacyPrompt("图像"));
  prompt.proof.assets[0].storage = "external";

  assert.ok(validatePromptV2(prompt).some((field) => field.includes("storage")));
});

test("fromPromptV2 preserves the legacy public compatibility contract", () => {
  const prompt = toPromptV2(legacyPrompt("图像"));
  const publicPrompt = fromPromptV2(prompt);

  assert.equal(publicPrompt.id, prompt.id);
  assert.equal(publicPrompt.coverImageUrl, "/prompts/proofs/generated/proof-v2-image.webp");
  assert.equal(publicPrompt.commercialProof.evidenceStatus, "preview");
  assert.equal(publicPrompt.status, "published-proofed");
});
