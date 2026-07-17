import test from "node:test";
import assert from "node:assert/strict";

import { buildProofStagePlan, buildReplacementPlan } from "../src/proof-planning.mjs";

function prompt(id, modality, proof = null, featured = false) {
  return {
    schemaVersion: 2,
    id,
    content: { title: id, prompt: `执行 ${id}` },
    classification: { modality },
    model: { tool: "目标工具", name: "target" },
    proof,
    publication: { featured, qualityScore: 90 }
  };
}

function previewProof(modality) {
  return {
    status: "preview",
    modality,
    assets: [{ role: "cover", storage: "repository", key: "proofs/generated/legacy.webp", url: "/prompts/proofs/generated/legacy.webp", mimeType: "image/webp" }]
  };
}

test("stage planning keeps batches at 25 and approval-gates paid work", () => {
  const prompts = [];
  for (let index = 0; index < 95; index += 1) prompts.push(prompt(`legacy-image-${index}`, "图像", previewProof("image")));
  for (let index = 0; index < 37; index += 1) prompts.push(prompt(`legacy-text-${index}`, "文本", previewProof("text")));
  for (let index = 0; index < 6; index += 1) prompts.push(prompt(`legacy-video-${index}`, "视频", previewProof("video")));
  for (let index = 0; index < 220; index += 1) prompts.push(prompt(`new-image-${index}`, "图像", null, index < 20));

  const plan = buildProofStagePlan(prompts, { stageTarget: 240, batchSize: 25 });

  assert.equal(plan.stageTarget, 240);
  assert.equal(plan.items.length, 240);
  assert.deepEqual(plan.targetMix, {
    reviewExistingImage: 95,
    generateImage: 102,
    generateText: 37,
    generateVideo: 6
  });
  assert.equal(plan.summary.reviewExisting, 95);
  assert.equal(plan.summary.generate, 145);
  assert.equal(plan.summary.image, 197);
  assert.equal(plan.summary.text, 37);
  assert.equal(plan.summary.video, 6);
  assert.equal(plan.batches.length, 10);
  assert.ok(plan.batches.every((batch) => batch.items.length === 24));
  assert.ok(plan.batches.every((batch) => batch.items.length <= 25));
  assert.ok(plan.batches.every((batch) => batch.approvalRequired));
  assert.ok(plan.batches.every((batch) => batch.costEstimate.status === "pricing-required"));
  assert.equal(plan.replacementReserve.imageIds.length, 95);
  assert.equal(new Set(plan.replacementReserve.imageIds).size, 95);
  assert.ok(plan.replacementReserve.imageIds.every((id) => !plan.items.some((item) => item.id === id)));
  assert.deepEqual(
    Object.fromEntries(Object.entries(Object.groupBy(plan.items, (item) => item.selectionReason)).map(([key, value]) => [key, value.length])),
    {
      "legacy-image-review": 95,
      "new-image-generation": 102,
      "legacy-text-rerun": 37,
      "legacy-video-rerun": 6
    }
  );
  assert.ok(plan.items.filter((item) => item.modality === "文本").every((item) => item.provider === "openai"));
  assert.ok(plan.items.filter((item) => item.modality === "视频").every((item) => item.provider === "dreamina"));
});

test("stage planning rejects a pilot dataset that cannot satisfy the locked target mix", () => {
  assert.throws(() => buildProofStagePlan([
    prompt("legacy-image", "图像", previewProof("image")),
    prompt("new-image", "图像")
  ], { stageTarget: 240, batchSize: 25 }), /cannot satisfy locked target mix/i);
});

test("replacement planning maps failed legacy reviews to deterministic reserve images", () => {
  const prompts = [];
  for (let index = 0; index < 95; index += 1) prompts.push(prompt(`legacy-image-${index}`, "图像", previewProof("image")));
  for (let index = 0; index < 37; index += 1) prompts.push(prompt(`legacy-text-${index}`, "文本", previewProof("text")));
  for (let index = 0; index < 6; index += 1) prompts.push(prompt(`legacy-video-${index}`, "视频", previewProof("video")));
  for (let index = 0; index < 220; index += 1) prompts.push(prompt(`new-image-${index}`, "图像"));
  const plan = buildProofStagePlan(prompts, { stageTarget: 240, batchSize: 25 });
  const failedIds = plan.items.filter((item) => item.selectionReason === "legacy-image-review").slice(0, 2).map((item) => item.id);
  const audit = {
    entries: Object.fromEntries(failedIds.map((id) => [id, { eligibility: "regenerate-required", blockers: ["missing-original-input"] }]))
  };

  const replacement = buildReplacementPlan(plan, audit);

  assert.equal(replacement.items.length, 2);
  assert.deepEqual(replacement.items.map((item) => item.replacesProofId), failedIds);
  assert.deepEqual(replacement.items.map((item) => item.id), plan.replacementReserve.imageIds.slice(0, 2));
  assert.ok(replacement.items.every((item) => item.selectionReason === "legacy-image-replacement"));
  assert.ok(replacement.items.every((item) => item.overwriteAllowed === false));
});

test("stage planning never schedules already verified prompts", () => {
  const verified = {
    status: "run-verified",
    modality: "image",
    assets: [{ role: "primary" }]
  };
  const plan = buildProofStagePlan([
    prompt("verified", "图像", verified, true),
    prompt("pending", "图像")
  ], { stageTarget: 1, batchSize: 25 });

  assert.deepEqual(plan.items.map((item) => item.id), ["pending"]);
});

test("stage planning rejects unsafe batch sizes", () => {
  assert.throws(
    () => buildProofStagePlan([prompt("pending", "图像")], { stageTarget: 1, batchSize: 26 }),
    /between 1 and 25/
  );
});

test("stage planning prefers direct OpenAI-compatible image templates over meta prompts", () => {
  const prompts = [];
  for (let index = 0; index < 95; index += 1) prompts.push(prompt(`legacy-image-${index}`, "\u56fe\u50cf", previewProof("image")));
  for (let index = 0; index < 37; index += 1) prompts.push(prompt(`legacy-text-${index}`, "\u6587\u672c", previewProof("text")));
  for (let index = 0; index < 6; index += 1) prompts.push(prompt(`legacy-video-${index}`, "\u89c6\u9891", previewProof("video")));
  for (let index = 0; index < 210; index += 1) {
    const item = prompt(`direct-image-${index}`, "\u56fe\u50cf");
    item.model.tool = index % 2 ? "DALL-E" : "ChatGPT / GPT Image";
    item.content.prompt = `Generate a commercial-safe product image ${index} with a clear subject, scene, composition, lighting, and no text.`;
    prompts.push(item);
  }
  for (let index = 0; index < 120; index += 1) {
    const item = prompt(`meta-image-${index}`, "\u56fe\u50cf", null, true);
    item.model.tool = "ChatGPT / GPT Image";
    item.content.prompt = `You are an assistant. Write an image prompt for {{subject-${index}}}.`;
    prompts.push(item);
  }

  const plan = buildProofStagePlan(prompts, { stageTarget: 240, batchSize: 25 });
  const selected = plan.items.filter((item) => item.selectionReason === "new-image-generation");
  const reserve = plan.replacementReserve.items;

  assert.equal(selected.length, 102);
  assert.equal(reserve.length, 95);
  assert.ok([...selected, ...reserve].every((item) => item.inputTemplateKind === "direct-image"));
  assert.ok([...selected, ...reserve].every((item) => ["DALL-E", "ChatGPT / GPT Image"].includes(item.sourceModelTool)));
});
