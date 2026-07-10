import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const promptSchema = JSON.parse(readFileSync(new URL("../schema/prompt-v1.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(promptSchema);

function clean(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function proofAssetPath(value) {
  return clean(value).replace(/^\/prompts\//, "");
}

export function shardForId(id) {
  return createHash("sha1").update(clean(id)).digest("hex").slice(0, 2);
}

export function promptPathForId(id) {
  const promptId = clean(id);
  if (!promptId) throw new Error("Prompt id is required.");
  return `data/prompts/${shardForId(promptId)}/${promptId}.json`;
}

export function toPromptV1(input) {
  const prompt = object(input);
  const commercialProof = object(prompt.commercialProof);
  const assetPath = proofAssetPath(prompt.coverImageUrl);
  const hasProof = Boolean(assetPath && commercialProof.model && commercialProof.testedAt);
  const source = clean(prompt.source) || "legacy-gallery-migration";

  return {
    schemaVersion: 1,
    id: clean(prompt.id),
    content: {
      title: clean(prompt.title),
      summary: clean(prompt.summary),
      preview: clean(prompt.preview),
      prompt: clean(prompt.prompt),
      copyPrompt: clean(prompt.copyPrompt),
      language: clean(prompt.language) || "zh-CN"
    },
    classification: {
      category: clean(prompt.category),
      department: clean(prompt.department),
      scenario: clean(prompt.scenario),
      task: clean(prompt.task),
      modality: clean(prompt.modality),
      useCase: clean(prompt.use ?? prompt.useCase),
      aspectRatio: clean(prompt.aspectRatio),
      difficulty: clean(prompt.difficulty),
      tags: list(prompt.tags),
      styleTags: list(prompt.styleTags),
      seoKeywords: list(prompt.seoKeywords)
    },
    model: {
      tool: clean(prompt.tool),
      name: clean(prompt.model)
    },
    variables: {
      names: list(prompt.variables),
      defaults: object(prompt.variableDefaults)
    },
    provenance: {
      source,
      authorName: clean(prompt.authorName),
      authorUrl: clean(prompt.authorUrl),
      sourceUrl: clean(prompt.sourceUrl),
      licenseType: clean(prompt.licenseType),
      licenseConfirmed: Boolean(prompt.licenseConfirmed),
      submissionIssueNumber: Number(prompt.submissionIssueNumber || 0) || null
    },
    proof: hasProof ? {
      assetPath,
      type: clean(commercialProof.type),
      model: clean(commercialProof.model),
      testedAt: clean(commercialProof.testedAt),
      resultNote: clean(commercialProof.resultNote),
      evidenceLevel: clean(commercialProof.evidenceLevel)
    } : null,
    publication: {
      status: clean(prompt.status) || (hasProof ? "published-proofed" : "published"),
      featured: Boolean(prompt.featured),
      copyReady: prompt.copyReady !== false,
      qualityScore: Number(prompt.qualityScore || 0),
      qualityLevel: clean(prompt.qualityLevel),
      verifiedAt: clean(prompt.verifiedAt),
      collectionIds: list(prompt.collectionIds),
      createdAt: clean(prompt.createdAt),
      updatedAt: clean(prompt.updatedAt),
      publishedAt: clean(prompt.publishedAt)
    }
  };
}

export function validatePromptV1(prompt) {
  if (validateSchema(prompt)) return [];
  const fields = (validateSchema.errors || []).map((error) => {
    const base = error.instancePath.replace(/^\//, "").replaceAll("/", ".");
    if (error.keyword === "required") {
      return [base, error.params.missingProperty].filter(Boolean).join(".");
    }
    if (error.keyword === "additionalProperties") {
      return [base, error.params.additionalProperty].filter(Boolean).join(".");
    }
    return base || "root";
  });
  const unique = [...new Set(fields)].sort();
  return unique.filter((field) => !unique.some((candidate) => candidate.startsWith(`${field}.`)));
}

export function fromPromptV1(prompt) {
  return {
    id: prompt.id,
    title: prompt.content.title,
    department: prompt.classification.department,
    scenario: prompt.classification.scenario,
    task: prompt.classification.task,
    category: prompt.classification.category,
    summary: prompt.content.summary,
    preview: prompt.content.preview,
    prompt: prompt.content.prompt,
    copyPrompt: prompt.content.copyPrompt,
    variables: prompt.variables.names,
    variableDefaults: prompt.variables.defaults,
    tool: prompt.model.tool,
    model: prompt.model.name,
    modality: prompt.classification.modality,
    language: prompt.content.language,
    qualityScore: prompt.publication.qualityScore,
    qualityLevel: prompt.publication.qualityLevel,
    featured: prompt.publication.featured,
    copyReady: prompt.publication.copyReady,
    tags: prompt.classification.tags,
    seoKeywords: prompt.classification.seoKeywords,
    aspectRatio: prompt.classification.aspectRatio,
    use: prompt.classification.useCase,
    difficulty: prompt.classification.difficulty,
    verifiedAt: prompt.publication.verifiedAt,
    source: prompt.provenance.source,
    styleTags: prompt.classification.styleTags,
    authorName: prompt.provenance.authorName,
    authorUrl: prompt.provenance.authorUrl,
    sourceUrl: prompt.provenance.sourceUrl,
    licenseType: prompt.provenance.licenseType,
    licenseConfirmed: prompt.provenance.licenseConfirmed,
    submissionIssueNumber: prompt.provenance.submissionIssueNumber,
    collectionIds: prompt.publication.collectionIds,
    coverImageUrl: prompt.proof ? `/prompts/${prompt.proof.assetPath}` : "",
    commercialProof: prompt.proof ? {
      type: prompt.proof.type,
      model: prompt.proof.model,
      testedAt: prompt.proof.testedAt,
      resultNote: prompt.proof.resultNote,
      evidenceLevel: prompt.proof.evidenceLevel
    } : null,
    status: prompt.publication.status,
    createdAt: prompt.publication.createdAt,
    updatedAt: prompt.publication.updatedAt,
    publishedAt: prompt.publication.publishedAt
  };
}
