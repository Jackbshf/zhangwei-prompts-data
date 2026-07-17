import test from "node:test";
import assert from "node:assert/strict";

import { buildCostPlan } from "../src/proof-costing.mjs";

const plan = {
  version: "proof-stage-plan-v2",
  stageTarget: 240,
  batches: [{
    batchId: "001",
    items: [
      { id: "review", action: "review-existing", modelRole: "image", sourcePrompt: "" },
      { id: "image", action: "generate", modelRole: "image", sourcePrompt: "生成图像" },
      { id: "text", action: "generate", modelRole: "text", sourcePrompt: "生成文本" },
      { id: "video", action: "generate", modelRole: "video", sourcePrompt: "生成视频" }
    ]
  }]
};

const pricing = {
  snapshotAt: "2026-07-17T00:00:00Z",
  sourceUrls: ["https://example.test/openai-pricing", "https://example.test/dreamina-pricing"],
  modelLocks: { openaiImage: "image-model", openaiText: "text-model", dreaminaVideo: "video-model" },
  rates: {
    imageUsdPerOutput: 0.2,
    textUsdPerMillionInputTokens: 1,
    textUsdPerMillionOutputTokens: 4,
    textMaximumOutputTokens: 1000,
    dreaminaCreditsPerVideo: 80
  }
};

test("cost plan derives batch estimates from a dated pricing snapshot", () => {
  const result = buildCostPlan(plan, pricing);

  assert.equal(result.approvalReady, true);
  assert.deepEqual(result.batches[0].counts, { review: 1, image: 1, text: 1, video: 1 });
  assert.equal(result.batches[0].estimatedDreaminaCredits, 80);
  assert.ok(result.batches[0].estimatedUsd > 0.2);
  assert.deepEqual(result.modelLocks, pricing.modelLocks);
});

test("cost plan remains blocked when pricing or model locks are incomplete", () => {
  const result = buildCostPlan(plan, { snapshotAt: "2026-07-17T00:00:00Z", sourceUrls: [] });

  assert.equal(result.approvalReady, false);
  assert.ok(result.missing.includes("sourceUrls"));
  assert.ok(result.missing.includes("modelLocks.openaiImage"));
  assert.ok(result.missing.includes("rates.dreaminaCreditsPerVideo"));
});
