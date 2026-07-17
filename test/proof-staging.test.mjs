import test from "node:test";
import assert from "node:assert/strict";

import { assertNoUntrackedStagingOutputs, validatedCompletedIds } from "../src/proof-staging.mjs";

const execution = {
  stageTarget: 240,
  batchId: "001",
  tasks: [
    { id: "image-001", execution: "openai-api" },
    { id: "text-001", execution: "openai-api" },
    { id: "video-001", execution: "dreamina-review-pack" }
  ]
};

test("staging validation resumes only tracked outputs from the same execution batch", () => {
  const staging = {
    stageTarget: 240,
    batchId: "001",
    outputs: [{ id: "image-001", file: "output/staging/image-001.png" }]
  };

  assert.deepEqual([...validatedCompletedIds(execution, staging)], ["image-001"]);
  assert.throws(() => validatedCompletedIds(execution, { ...staging, batchId: "002" }), /different stage or batch/i);
  assert.throws(() => validatedCompletedIds(execution, {
    ...staging,
    outputs: [...staging.outputs, staging.outputs[0]]
  }), /duplicate staging output/i);
  assert.throws(() => validatedCompletedIds(execution, {
    ...staging,
    outputs: [{ id: "unknown", file: "output/staging/unknown.png" }]
  }), /not an OpenAI task/i);
});

test("staging validation refuses an untracked file before a paid retry", async () => {
  const seen = [];
  await assert.rejects(() => assertNoUntrackedStagingOutputs(
    execution,
    new Set(["image-001"]),
    "C:/staging",
    async (file) => {
      seen.push(file.replaceAll("\\", "/"));
      return file.replaceAll("\\", "/").endsWith("/text-001.txt");
    }
  ), /untracked staging output/i);
  assert.ok(seen.some((file) => file.endsWith("/text-001.txt")));
});
