import { createHash } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uint24(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

export function readWebpDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Invalid WebP container.");
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + length > buffer.length) throw new Error("Truncated WebP chunk.");
    if (type === "VP8X" && length >= 10) {
      return { width: uint24(buffer, dataOffset + 4) + 1, height: uint24(buffer, dataOffset + 7) + 1 };
    }
    if (type === "VP8 " && length >= 10 && buffer[dataOffset + 3] === 0x9d && buffer[dataOffset + 4] === 0x01 && buffer[dataOffset + 5] === 0x2a) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff
      };
    }
    if (type === "VP8L" && length >= 5 && buffer[dataOffset] === 0x2f) {
      const bits = buffer.readUInt32LE(dataOffset + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    offset = dataOffset + length + (length % 2);
  }
  throw new Error("WebP dimensions are unavailable.");
}

function confirmedRights(confirmedAt) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(String(confirmedAt || ""));
  return {
    status: valid ? "confirmed" : "pending",
    basis: valid ? "repository-owner-confirmed" : "",
    confirmedAt: valid ? confirmedAt : "",
    note: valid ? "The repository owner confirmed rights to use the legacy preview asset." : ""
  };
}

export function buildLegacySourceInputMap(sources) {
  const entries = new Map();
  for (const source of sources) {
    const reference = String(source.reference || "");
    for (const item of source.items || []) {
      const id = String(item.promptId || item.id || "").trim();
      const sourceInput = String(item.generationInstruction || item.sourcePrompt || item.prompt || "").trim();
      if (!id || !sourceInput) continue;
      entries.set(id, {
        sourceInput,
        sourceInputReference: `${reference}#${id}`,
        sourceInputSha256: sha256(sourceInput)
      });
    }
  }
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right, "en")));
}

export function buildLegacyProofAudit(prompt, legacyEntry, assetBytes, options = {}) {
  const sourceInput = String(options.sourceInput || "");
  const sourceInputReference = String(options.sourceInputReference || "");
  const rights = confirmedRights(options.rightsConfirmedAt);
  const blockers = [];
  let dimensions = null;
  try {
    dimensions = readWebpDimensions(assetBytes);
  } catch {
    blockers.push("invalid-webp");
  }
  if (!String(legacyEntry?.model || "").trim()) blockers.push("missing-model");
  if (!String(legacyEntry?.generatedAt || "").trim()) blockers.push("missing-generated-at");
  if (!sourceInput.trim()) blockers.push("missing-original-input");
  if (rights.status !== "confirmed") blockers.push("rights-unconfirmed");
  if (prompt.proof?.modality !== "image") blockers.push("preview-cover-is-not-modality-output");

  const outputSha256 = sha256(assetBytes);
  const eligibility = blockers.length ? "regenerate-required" : "human-review-ready";
  const currentAsset = prompt.proof?.assets?.[0] || {};
  const checks = [
    dimensions ? "webp-decodable" : "webp-invalid",
    outputSha256 ? "output-sha256-recorded" : "output-sha256-missing",
    sourceInput ? "original-input-recovered" : "original-input-missing",
    rights.status === "confirmed" ? "asset-rights-confirmed" : "asset-rights-pending",
    prompt.proof?.modality === "image" ? "modality-output-matched" : "modality-output-mismatched"
  ];
  const proof = {
    ...prompt.proof,
    status: "preview",
    provider: prompt.proof?.modality === "image" ? "openai" : "legacy-gallery",
    model: String(legacyEntry?.model || prompt.proof?.model || ""),
    testedAt: String(legacyEntry?.generatedAt || prompt.proof?.testedAt || ""),
    resultNote: eligibility === "human-review-ready"
      ? "Legacy generated image has complete run provenance and awaits human visual review."
      : "Legacy cover remains an effect preview and requires a new modality-matched run.",
    evidenceLevel: "generated-preview",
    rights,
    assets: [{
      ...currentAsset,
      role: "cover",
      mimeType: "image/webp",
      sha256: outputSha256,
      bytes: assetBytes.length,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      durationMs: null
    }],
    run: {
      runId: `legacy-${prompt.id}`,
      inputSha256: sourceInput ? sha256(sourceInput) : "",
      outputSha256,
      parameters: {
        source: String(legacyEntry?.source || "legacy-gallery"),
        sourceInputReference,
        inputRecovery: sourceInput ? "exact" : "missing",
        outputRole: "preview-cover"
      },
      attempt: 1
    },
    qa: {
      automatedStatus: eligibility === "human-review-ready" ? "passed" : "failed",
      humanStatus: "not-reviewed",
      checks,
      reviewedAt: "",
      failureReason: blockers.join(",")
    }
  };
  return {
    proof,
    audit: {
      id: prompt.id,
      modality: prompt.proof?.modality || "",
      eligibility,
      blockers,
      sourceInputReference,
      inputSha256: proof.run.inputSha256,
      outputSha256,
      rightsStatus: rights.status,
      automatedStatus: proof.qa.automatedStatus,
      humanStatus: proof.qa.humanStatus
    }
  };
}
