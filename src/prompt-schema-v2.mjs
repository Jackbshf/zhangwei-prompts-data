import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { fromPromptV1, toPromptV1 } from "./prompt-schema.mjs";

const schema = JSON.parse(readFileSync(new URL("../schema/prompt-v2.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function modalityName(value) {
  if (value === "图像") return "image";
  if (value === "视频") return "video";
  return "text";
}

function legacyProof(prompt) {
  if (!prompt.proof) return null;
  const assetPath = prompt.proof.assetPath;
  return {
    status: "preview",
    modality: modalityName(prompt.classification.modality),
    provider: "legacy-gallery",
    model: prompt.proof.model,
    testedAt: prompt.proof.testedAt,
    resultNote: prompt.proof.resultNote,
    evidenceLevel: prompt.proof.evidenceLevel || "generated-preview",
    rights: {
      status: "pending",
      basis: "",
      confirmedAt: "",
      note: ""
    },
    assets: [{
      role: "cover",
      storage: "repository",
      key: assetPath,
      url: `/prompts/${assetPath}`,
      mimeType: "image/webp",
      sha256: "",
      bytes: 0,
      width: null,
      height: null,
      durationMs: null
    }],
    run: {
      runId: "",
      inputSha256: "",
      outputSha256: "",
      parameters: {},
      attempt: 0
    },
    qa: {
      automatedStatus: "pending",
      humanStatus: "not-reviewed",
      checks: [],
      reviewedAt: "",
      failureReason: ""
    }
  };
}

function errorFields(errors = []) {
  const fields = errors.map((error) => {
    const base = error.instancePath.replace(/^\//, "").replaceAll("/", ".");
    if (error.keyword === "required") return [base, error.params.missingProperty].filter(Boolean).join(".");
    if (error.keyword === "additionalProperties") return [base, error.params.additionalProperty].filter(Boolean).join(".");
    return base || "root";
  });
  const unique = [...new Set(fields)].sort();
  return unique.filter((field) => !unique.some((candidate) => candidate.startsWith(`${field}.`)));
}

export function toPromptV2(input) {
  const v1 = input?.schemaVersion === 1 ? input : toPromptV1(input);
  return {
    ...v1,
    schemaVersion: 2,
    provenance: {
      ...v1.provenance,
      rightsStatus: v1.provenance.licenseConfirmed ? "confirmed" : "pending"
    },
    proof: legacyProof(v1),
    publication: {
      ...v1.publication,
      qualityAssessment: {
        status: "pending",
        rubricVersion: "prompt-quality-v2",
        score: null,
        checkedAt: "",
        issues: []
      }
    }
  };
}

export function validatePromptV2(prompt) {
  const fields = validateSchema(prompt) ? [] : errorFields(validateSchema.errors);
  const proof = prompt?.proof;
  if (proof && ["run-verified", "human-reviewed"].includes(proof.status)) {
    const primary = proof.assets?.find((asset) => asset.role === "primary");
    if (!primary || !/^[0-9a-f]{64}$/.test(primary.sha256 || "")) fields.push("proof.assets.primary");
    if (!/^[0-9a-f]{64}$/.test(proof.run?.inputSha256 || "")) fields.push("proof.run.inputSha256");
    if (!/^[0-9a-f]{64}$/.test(proof.run?.outputSha256 || "")) fields.push("proof.run.outputSha256");
    if (proof.qa?.automatedStatus !== "passed") fields.push("proof.qa.automatedStatus");
    if (proof.rights?.status !== "confirmed") fields.push("proof.rights.status");
    if (Number(prompt.publication?.qualityScore || 0) < 85) fields.push("publication.qualityScore");
  }
  if (proof?.status === "human-reviewed" && proof.qa?.humanStatus !== "passed") fields.push("proof.qa.humanStatus");
  return [...new Set(fields)].sort();
}

export function fromPromptV2(prompt) {
  const cover = prompt.proof?.assets?.find((asset) => asset.role === "cover")
    || prompt.proof?.assets?.find((asset) => asset.role === "primary");
  const compatibility = fromPromptV1({
    ...prompt,
    schemaVersion: 1,
    provenance: {
      source: prompt.provenance.source,
      authorName: prompt.provenance.authorName,
      authorUrl: prompt.provenance.authorUrl,
      sourceUrl: prompt.provenance.sourceUrl,
      licenseType: prompt.provenance.licenseType,
      licenseConfirmed: prompt.provenance.licenseConfirmed,
      submissionIssueNumber: prompt.provenance.submissionIssueNumber
    },
    proof: cover ? {
      assetPath: cover.url.replace(/^\/prompts\//, ""),
      type: prompt.proof.evidenceLevel,
      model: prompt.proof.model,
      testedAt: prompt.proof.testedAt,
      resultNote: prompt.proof.resultNote,
      evidenceLevel: prompt.proof.evidenceLevel
    } : null,
    publication: {
      status: prompt.publication.status,
      featured: prompt.publication.featured,
      copyReady: prompt.publication.copyReady,
      qualityScore: prompt.publication.qualityScore,
      qualityLevel: prompt.publication.qualityLevel,
      verifiedAt: prompt.publication.verifiedAt,
      collectionIds: prompt.publication.collectionIds,
      createdAt: prompt.publication.createdAt,
      updatedAt: prompt.publication.updatedAt,
      publishedAt: prompt.publication.publishedAt
    }
  });
  if (compatibility.commercialProof) compatibility.commercialProof.evidenceStatus = prompt.proof.status;
  compatibility.proofV2 = prompt.proof;
  compatibility.qualityAssessment = prompt.publication.qualityAssessment;
  compatibility.rightsStatus = prompt.provenance.rightsStatus;
  return compatibility;
}
