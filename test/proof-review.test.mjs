import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { buildLegacyProofAudit, buildLegacySourceInputMap, readWebpDimensions } from "../src/proof-review.mjs";

function vp8x(width, height) {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8);
  buffer.write("VP8X", 12);
  buffer.writeUInt32LE(10, 16);
  data.copy(buffer, 20);
  return buffer;
}

function prompt(modality = "image") {
  return {
    id: `legacy-${modality}`,
    proof: {
      status: "preview",
      modality,
      assets: [{
        role: "cover",
        storage: "repository",
        key: `proofs/generated/legacy-${modality}.webp`,
        url: `/prompts/proofs/generated/legacy-${modality}.webp`,
        mimeType: "image/webp",
        sha256: "",
        bytes: 0,
        width: null,
        height: null,
        durationMs: null
      }]
    },
    publication: { qualityScore: 90 }
  };
}

const legacyEntry = {
  model: "ChatGPT web / GPT Image",
  generatedAt: "2026-05-24T11:40:49.477Z",
  source: "Codex browser automation"
};

test("readWebpDimensions reads VP8X dimensions", () => {
  assert.deepEqual(readWebpDimensions(vp8x(1536, 1152)), { width: 1536, height: 1152 });
});

test("legacy image proof becomes human-review-ready only with exact input and confirmed rights", () => {
  const bytes = vp8x(1536, 1152);
  const result = buildLegacyProofAudit(prompt("image"), legacyEntry, bytes, {
    sourceInput: "生成一张电影感人物图像",
    sourceInputReference: "legacy-gallery/output/batch.json#legacy-image",
    rightsConfirmedAt: "2026-07-17"
  });

  assert.equal(result.audit.eligibility, "human-review-ready");
  assert.deepEqual(result.audit.blockers, []);
  assert.equal(result.proof.rights.status, "confirmed");
  assert.equal(result.proof.provider, "openai");
  assert.equal(result.proof.testedAt, legacyEntry.generatedAt);
  assert.equal(result.proof.qa.automatedStatus, "passed");
  assert.equal(result.proof.qa.humanStatus, "not-reviewed");
  assert.equal(result.proof.assets[0].width, 1536);
  assert.equal(result.proof.assets[0].height, 1152);
  assert.equal(result.proof.run.inputSha256, createHash("sha256").update("生成一张电影感人物图像").digest("hex"));
  assert.equal(result.proof.run.outputSha256, createHash("sha256").update(bytes).digest("hex"));
});

test("legacy image proof without its exact generation input requires regeneration", () => {
  const result = buildLegacyProofAudit(prompt("image"), legacyEntry, vp8x(1536, 1152), {
    sourceInput: "",
    rightsConfirmedAt: "2026-07-17"
  });

  assert.equal(result.audit.eligibility, "regenerate-required");
  assert.ok(result.audit.blockers.includes("missing-original-input"));
  assert.equal(result.proof.qa.automatedStatus, "failed");
});

test("legacy text and video covers cannot become modality proof", () => {
  for (const modality of ["text", "video"]) {
    const result = buildLegacyProofAudit(prompt(modality), legacyEntry, vp8x(1536, 1152), {
      sourceInput: "旧封面生成输入",
      rightsConfirmedAt: "2026-07-17"
    });
    assert.equal(result.audit.eligibility, "regenerate-required");
    assert.ok(result.audit.blockers.includes("preview-cover-is-not-modality-output"));
  }
});

test("legacy source input import is deterministic and lets the later execution batch win", () => {
  const entries = buildLegacySourceInputMap([
    {
      reference: "legacy-gallery/output/preview-image-batch-001.json",
      items: [{ promptId: "prompt-001", generationInstruction: "早期候选输入" }]
    },
    {
      reference: "legacy-gallery/output/stage-01-batch-001-050.json",
      items: [
        { promptId: "prompt-002", generationInstruction: "第二条输入" },
        { promptId: "prompt-001", generationInstruction: "实际执行输入" }
      ]
    }
  ]);

  assert.deepEqual(Object.keys(entries), ["prompt-001", "prompt-002"]);
  assert.equal(entries["prompt-001"].sourceInput, "实际执行输入");
  assert.equal(entries["prompt-001"].sourceInputReference, "legacy-gallery/output/stage-01-batch-001-050.json#prompt-001");
  assert.match(entries["prompt-001"].sourceInputSha256, /^[0-9a-f]{64}$/);
});
