import assert from "node:assert/strict";
import test from "node:test";

import { LEGACY_MACHINE_CHECKS, promoteLegacyProofToRunVerified, validateLegacyRunDecisionBatch } from "../src/proof-promotion.mjs";

const inputSha256 = "a".repeat(64);
const outputSha256 = "b".repeat(64);
const id = "legacy-image-001";

function decision(overrides = {}) {
  return {
    schemaVersion: 1,
    decisionBatch: "legacy-machine-verification-2026-07-18",
    verificationType: "machine-assisted",
    humanReviewClaimed: false,
    verifiedAt: "2026-07-18",
    checks: [...LEGACY_MACHINE_CHECKS],
    approvedIds: [id],
    ...overrides
  };
}

function prompt() {
  return {
    id,
    proof: {
      status: "preview",
      modality: "image",
      provider: "openai",
      model: "ChatGPT web / GPT Image",
      testedAt: "2026-07-05T00:00:00Z",
      resultNote: "preview",
      evidenceLevel: "generated-preview",
      rights: { status: "confirmed" },
      assets: [{ role: "cover", storage: "repository", key: `proofs/generated/${id}.webp`, sha256: outputSha256 }],
      run: { inputSha256, outputSha256, parameters: {} },
      qa: { automatedStatus: "passed", humanStatus: "not-reviewed", checks: ["webp-decodable"], reviewedAt: "", failureReason: "" }
    },
    publication: { qualityScore: 90, qualityAssessment: { status: "passed" } }
  };
}

function audit(overrides = {}) {
  return {
    id,
    eligibility: "human-review-ready",
    blockers: [],
    modality: "image",
    model: "ChatGPT web / GPT Image",
    testedAt: "2026-07-05T00:00:00Z",
    inputSha256,
    outputSha256,
    rightsStatus: "confirmed",
    automatedStatus: "passed",
    humanStatus: "not-reviewed",
    ...overrides
  };
}

test("machine-assisted decisions promote exact audited outputs without claiming human review", () => {
  const promoted = promoteLegacyProofToRunVerified(prompt(), audit(), decision());

  assert.equal(promoted.proof.status, "run-verified");
  assert.equal(promoted.proof.evidenceLevel, "verified-output");
  assert.equal(promoted.proof.assets[0].role, "primary");
  assert.equal(promoted.proof.qa.humanStatus, "not-reviewed");
  assert.equal(promoted.proof.qa.reviewedAt, "");
  assert.ok(promoted.proof.qa.checks.includes("machine-assisted:commercial-safety"));
  assert.equal(promoted.proof.run.parameters.verificationType, "machine-assisted");
  assert.deepEqual(promoteLegacyProofToRunVerified(promoted, audit(), decision()), promoted);
});

test("legacy promotion rejects blockers, hash drift, and false human-review claims", () => {
  assert.throws(() => promoteLegacyProofToRunVerified(prompt(), audit({ eligibility: "regenerate-required", blockers: ["missing-original-input"] }), decision()), /not eligible/i);
  assert.throws(() => promoteLegacyProofToRunVerified(prompt(), audit({ outputSha256: "c".repeat(64) }), decision()), /output hash/i);
  assert.throws(() => promoteLegacyProofToRunVerified(prompt(), audit(), decision({ humanReviewClaimed: true })), /cannot claim human review/i);
});

test("legacy decision batches require sorted unique ids and every machine check", () => {
  assert.throws(() => validateLegacyRunDecisionBatch(decision({ approvedIds: ["z", "a"] })), /must be sorted/i);
  assert.throws(() => validateLegacyRunDecisionBatch(decision({ approvedIds: [id, id] })), /duplicate/i);
  assert.throws(() => validateLegacyRunDecisionBatch(decision({ checks: ["visual-relevance"] })), /missing required check/i);
});
