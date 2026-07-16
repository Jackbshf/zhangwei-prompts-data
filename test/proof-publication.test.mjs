import test from "node:test";
import assert from "node:assert/strict";

import { assertPublicationTargetsAbsent, buildR2PublicationManifest } from "../src/proof-publication.mjs";

const digest = "a".repeat(64);
const execution = {
  version: "proof-execution-manifest-v2",
  stageTarget: 240,
  batchId: "001",
  tasks: [{
    id: "image-001",
    execution: "openai-api",
    targetKey: "proofs/v2/image-001/stage-240/image",
    inputSha256: "b".repeat(64),
    overwriteAllowed: false
  }]
};

function staging(qaStatus = "passed") {
  return {
    stageTarget: 240,
    batchId: "001",
    outputs: [{
      id: "image-001",
      file: "output/staging/stage-240-batch-001/image-001.png",
      mimeType: "image/png",
      bytes: 1024,
      sha256: digest,
      qaStatus
    }]
  };
}

test("R2 publication manifest uses content-addressed non-overwriting keys", () => {
  const manifest = buildR2PublicationManifest(execution, staging());

  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].key, `proofs/v2/image-001/stage-240/image/${digest}.png`);
  assert.equal(manifest.assets[0].url, `/prompts/media/proofs/v2/image-001/stage-240/image/${digest}.png`);
  assert.equal(manifest.assets[0].overwriteAllowed, false);
  assert.equal(manifest.assets[0].inputSha256, "b".repeat(64));
});

test("R2 publication manifest blocks pending QA and existing remote targets", async () => {
  assert.throws(() => buildR2PublicationManifest(execution, staging("pending")), /QA-passed/i);
  const manifest = buildR2PublicationManifest(execution, staging());
  await assert.rejects(
    () => assertPublicationTargetsAbsent(manifest, async (key) => key === manifest.assets[0].key),
    /already exists/i
  );
});
