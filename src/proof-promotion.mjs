const SHA256 = /^[0-9a-f]{64}$/;

export const LEGACY_MACHINE_CHECKS = Object.freeze([
  "prompt-id-match",
  "visual-relevance",
  "no-duplicate-image",
  "no-watermark-or-recognizable-brand",
  "no-garbled-readable-text",
  "no-obvious-anatomy-or-object-failure",
  "commercial-safety"
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedIds(value) {
  assert(Array.isArray(value) && value.length > 0, "Run verification decisions require approvedIds.");
  const ids = value.map((id) => String(id || "").trim());
  assert(ids.every(Boolean), "Run verification decisions contain an empty prompt id.");
  assert(new Set(ids).size === ids.length, "Run verification decisions contain duplicate prompt ids.");
  const sorted = [...ids].sort((left, right) => left.localeCompare(right, "en"));
  assert(ids.every((id, index) => id === sorted[index]), "Run verification decision ids must be sorted.");
  return ids;
}

export function validateLegacyRunDecisionBatch(batch) {
  assert(batch?.schemaVersion === 1, "Unsupported run verification decision schema.");
  assert(String(batch.decisionBatch || "").trim(), "Run verification decisionBatch is required.");
  assert(batch.verificationType === "machine-assisted", "Legacy run verification must be machine-assisted.");
  assert(batch.humanReviewClaimed === false, "Machine-assisted verification cannot claim human review.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(String(batch.verifiedAt || "")), "verifiedAt must use YYYY-MM-DD.");
  assert(Array.isArray(batch.checks), "Run verification checks are required.");
  for (const check of LEGACY_MACHINE_CHECKS) {
    assert(batch.checks.includes(check), `Run verification is missing required check: ${check}`);
  }
  return { ...batch, approvedIds: normalizedIds(batch.approvedIds) };
}

function matchingAsset(proof, auditEntry) {
  return (proof.assets || []).find((asset) => (
    asset.storage === "repository"
    && asset.sha256 === auditEntry.outputSha256
    && ["cover", "primary"].includes(asset.role)
  ));
}

export function promoteLegacyProofToRunVerified(prompt, auditEntry, decisionBatch) {
  const batch = validateLegacyRunDecisionBatch(decisionBatch);
  assert(batch.approvedIds.includes(prompt?.id), `Prompt is not approved by the decision batch: ${prompt?.id || "<missing>"}`);
  assert(auditEntry?.id === prompt.id, `Audit evidence does not match prompt: ${prompt.id}`);
  assert(auditEntry.eligibility === "human-review-ready", `Prompt is not eligible for run verification: ${prompt.id}`);
  assert(Array.isArray(auditEntry.blockers) && auditEntry.blockers.length === 0, `Prompt has unresolved proof blockers: ${prompt.id}`);
  assert(auditEntry.modality === "image" && prompt.proof?.modality === "image", `Prompt proof is not an image output: ${prompt.id}`);
  assert(prompt.proof?.status === "preview" || prompt.proof?.status === "run-verified", `Prompt has an incompatible proof status: ${prompt.id}`);
  assert(prompt.proof?.provider === "openai", `Prompt proof provider is not the audited provider: ${prompt.id}`);
  assert(String(prompt.proof?.model || "").trim() === String(auditEntry.model || "").trim(), `Prompt proof model does not match audit: ${prompt.id}`);
  assert(String(prompt.proof?.testedAt || "").trim() === String(auditEntry.testedAt || "").trim(), `Prompt proof date does not match audit: ${prompt.id}`);
  assert(SHA256.test(String(auditEntry.inputSha256 || "")) && prompt.proof?.run?.inputSha256 === auditEntry.inputSha256, `Prompt input hash does not match audit: ${prompt.id}`);
  assert(SHA256.test(String(auditEntry.outputSha256 || "")) && prompt.proof?.run?.outputSha256 === auditEntry.outputSha256, `Prompt output hash does not match audit: ${prompt.id}`);
  assert(prompt.proof?.rights?.status === "confirmed" && auditEntry.rightsStatus === "confirmed", `Prompt proof asset rights are not confirmed: ${prompt.id}`);
  assert(prompt.proof?.qa?.automatedStatus === "passed" && auditEntry.automatedStatus === "passed", `Prompt automated proof checks have not passed: ${prompt.id}`);
  assert(prompt.proof?.qa?.humanStatus === "not-reviewed" && auditEntry.humanStatus === "not-reviewed", `Prompt unexpectedly claims human review: ${prompt.id}`);
  assert(prompt.publication?.qualityAssessment?.status === "passed" && Number(prompt.publication?.qualityScore || 0) >= 85, `Prompt quality gate has not passed: ${prompt.id}`);
  const asset = matchingAsset(prompt.proof, auditEntry);
  assert(asset, `Prompt proof asset does not match the audited output: ${prompt.id}`);

  const checks = [...new Set([
    ...(prompt.proof.qa.checks || []),
    ...batch.checks.map((check) => `machine-assisted:${check}`)
  ])];
  return {
    ...prompt,
    proof: {
      ...prompt.proof,
      status: "run-verified",
      resultNote: "Actual model output is linked to its exact recovered generation input and passed machine-assisted asset checks; human visual review is not claimed.",
      evidenceLevel: "verified-output",
      assets: prompt.proof.assets.map((item) => item === asset ? { ...item, role: "primary" } : item),
      run: {
        ...prompt.proof.run,
        parameters: {
          ...prompt.proof.run.parameters,
          outputRole: "verified-preview-generation-output",
          verificationDecision: `data/proofs/legacy-run-verification-decisions.json#${prompt.id}`,
          verificationType: "machine-assisted"
        }
      },
      qa: {
        ...prompt.proof.qa,
        automatedStatus: "passed",
        humanStatus: "not-reviewed",
        checks,
        reviewedAt: "",
        failureReason: ""
      }
    }
  };
}

export function proofManifestEntry(proof) {
  return {
    status: proof.status,
    modality: proof.modality,
    provider: proof.provider,
    model: proof.model,
    testedAt: proof.testedAt,
    evidenceLevel: proof.evidenceLevel,
    rights: proof.rights,
    assets: proof.assets,
    run: proof.run,
    qa: proof.qa
  };
}
