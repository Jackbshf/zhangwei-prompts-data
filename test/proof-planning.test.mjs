import test from "node:test";
import assert from "node:assert/strict";

import { buildProofStagePlan } from "../src/proof-planning.mjs";

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
  for (let index = 0; index < 150; index += 1) prompts.push(prompt(`new-image-${index}`, "图像", null, index < 20));

  const plan = buildProofStagePlan(prompts, { stageTarget: 240, batchSize: 25 });

  assert.equal(plan.stageTarget, 240);
  assert.equal(plan.items.length, 240);
  assert.equal(plan.summary.reviewExisting, 95);
  assert.equal(plan.summary.generate, 145);
  assert.ok(plan.batches.every((batch) => batch.items.length <= 25));
  assert.ok(plan.batches.every((batch) => batch.approvalRequired));
  assert.ok(plan.items.filter((item) => item.modality === "文本").every((item) => item.provider === "openai"));
  assert.ok(plan.items.filter((item) => item.modality === "视频").every((item) => item.provider === "dreamina"));
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
