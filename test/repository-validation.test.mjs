import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { promptPathForId, toPromptV1 } from "../src/prompt-schema.mjs";
import { toPromptV2 } from "../src/prompt-schema-v2.mjs";
import { validateRepository } from "../src/repository-validation.mjs";
import { exclusionReportDigest } from "../src/migration.mjs";

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function proofManifestEntry(proof) {
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

async function fixtureRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "prompts-repo-test-"));
  const prompt = toPromptV1({
    id: "valid-001",
    title: "有效提示词",
    category: "图像",
    summary: "有效摘要",
    prompt: "有效正文",
    tool: "通用中文",
    modality: "图像",
    source: "测试来源",
    copyReady: true,
    collectionIds: ["visual"]
  });
  await writeJson(path.join(root, promptPathForId(prompt.id)), prompt);
  await writeJson(path.join(root, "data/collections/visual.json"), {
    schemaVersion: 1,
    id: "visual",
    title: "视觉",
    promptCount: 1
  });
  await writeJson(path.join(root, "data/proofs/manifest.json"), { images: {} });
  const exclusionReport = {
    sourceCount: 2,
    publicCount: 1,
    excludedCount: 1,
    counts: { "not-free": 1, "not-copy-ready": 0, archived: 0, deduplicated: 0 },
    excluded: [{ id: "paid-001", reason: "not-free" }]
  };
  const exclusionText = `${JSON.stringify(exclusionReport, null, 2)}\n`;
  await mkdir(path.join(root, "data/reports"), { recursive: true });
  await writeFile(path.join(root, "data/reports/migration-exclusions.json"), exclusionText);
  await writeJson(path.join(root, "data/reports/migration-summary.json"), {
    prompts: 1,
    collections: 1,
    proofs: 0,
    excluded: 1,
    exclusionReportSha256: exclusionReportDigest(exclusionReport)
  });
  return { root, prompt };
}

test("validateRepository verifies prompt paths, counts, collections, and reports", async () => {
  const { root } = await fixtureRepository();
  const result = await validateRepository(root, {
    expectedPrompts: 1,
    expectedCollections: 1,
    expectedProofs: 0,
    expectedExcluded: 1
  });

  assert.deepEqual(result, { prompts: 1, collections: 1, proofs: 0, excluded: 1 });
});

test("validateRepository accepts canonical Schema v2 evidence and rejects manifest rights drift", async () => {
  const { root, prompt: promptV1 } = await fixtureRepository();
  const prompt = toPromptV2(promptV1);
  const digest = "a".repeat(64);
  prompt.publication.qualityScore = 90;
  prompt.proof = {
    status: "run-verified",
    modality: "image",
    provider: "openai",
    model: "gpt-image",
    testedAt: "2026-07-12",
    resultNote: "真实图像结果通过自动检查。",
    evidenceLevel: "verified-output",
    rights: { status: "confirmed", basis: "owner-confirmed", confirmedAt: "2026-07-12", note: "测试授权" },
    assets: [{
      role: "primary",
      storage: "repository",
      key: "proofs/v2/valid-001/run-001/result.webp",
      url: "/prompts/media/proofs/v2/valid-001/run-001/result.webp",
      mimeType: "image/webp",
      sha256: digest,
      bytes: 1024,
      width: 1536,
      height: 1152,
      durationMs: null
    }],
    run: { runId: "run-001", inputSha256: digest, outputSha256: digest, parameters: {}, attempt: 1 },
    qa: { automatedStatus: "passed", humanStatus: "not-reviewed", checks: ["decode"], reviewedAt: "", failureReason: "" }
  };
  await mkdir(path.join(root, "data/proofs/v2/valid-001/run-001"), { recursive: true });
  await writeFile(path.join(root, "data/proofs/v2/valid-001/run-001/result.webp"), "proof");
  await writeJson(path.join(root, promptPathForId(prompt.id)), prompt);
  await writeJson(path.join(root, "data/proofs/manifest-v2.json"), {
    schemaVersion: 2,
    releaseBatch: "test",
    entries: { [prompt.id]: proofManifestEntry(prompt.proof) }
  });

  const result = await validateRepository(root, { expectedPrompts: 1, expectedProofs: 0 });
  assert.equal(result.prompts, 1);

  await writeJson(path.join(root, "data/proofs/manifest-v2.json"), {
    schemaVersion: 2,
    releaseBatch: "test",
    entries: {
      [prompt.id]: {
        ...proofManifestEntry(prompt.proof),
        rights: { ...prompt.proof.rights, status: "pending" }
      }
    }
  });
  await assert.rejects(() => validateRepository(root), /proof manifest metadata mismatch/i);
});

test("validateRepository rejects a prompt stored under the wrong shard", async () => {
  const { root, prompt } = await fixtureRepository();
  const wrongPath = path.join(root, "data/prompts/zz/valid-002.json");
  await writeJson(wrongPath, { ...prompt, id: "valid-002" });

  await assert.rejects(() => validateRepository(root), /path mismatch/i);
});

test("validateRepository rejects orphan proof manifest entries", async () => {
  const { root } = await fixtureRepository();
  await writeJson(path.join(root, "data/proofs/manifest.json"), {
    images: {
      "orphan-001": {
        promptId: "orphan-001",
        coverImageUrl: "/prompts/proofs/generated/orphan-001.webp"
      }
    }
  });

  await assert.rejects(() => validateRepository(root), /orphan proof manifest/i);
});

test("validateRepository rejects unverifiable deduplication evidence", async () => {
  const { root } = await fixtureRepository();
  const report = {
    sourceCount: 2,
    publicCount: 1,
    excludedCount: 1,
    counts: { "not-free": 0, "not-copy-ready": 0, archived: 0, deduplicated: 1 },
    excluded: [{ id: "duplicate-001", reason: "deduplicated" }]
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.join(root, "data/reports/migration-exclusions.json"), reportText);
  await writeJson(path.join(root, "data/reports/migration-summary.json"), {
    prompts: 1,
    collections: 1,
    proofs: 0,
    excluded: 1,
    exclusionReportSha256: exclusionReportDigest(report)
  });

  await assert.rejects(() => validateRepository(root), /deduplication evidence/i);
});

test("validateRepository rejects an exclusion report whose digest changed", async () => {
  const { root } = await fixtureRepository();
  const reportPath = path.join(root, "data/reports/migration-exclusions.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  report.excluded[0].title = "tampered";
  await writeJson(reportPath, report);

  await assert.rejects(() => validateRepository(root), /digest mismatch/i);
});

test("validateRepository rejects overlapping or duplicate exclusion ids", async () => {
  const { root } = await fixtureRepository();
  const report = {
    sourceCount: 3,
    publicCount: 1,
    excludedCount: 2,
    counts: { "not-free": 2, "not-copy-ready": 0, archived: 0, deduplicated: 0 },
    excluded: [
      { id: "valid-001", reason: "not-free" },
      { id: "valid-001", reason: "not-free" }
    ]
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.join(root, "data/reports/migration-exclusions.json"), reportText);
  await writeJson(path.join(root, "data/reports/migration-summary.json"), {
    prompts: 1,
    collections: 1,
    proofs: 0,
    excluded: 2,
    exclusionReportSha256: exclusionReportDigest(report)
  });

  await assert.rejects(() => validateRepository(root), /exclusion id/i);
});

test("validateRepository rejects exclusion reasons that are not declared categories", async () => {
  const { root } = await fixtureRepository();
  const report = {
    sourceCount: 2,
    publicCount: 1,
    excludedCount: 1,
    counts: { "not-free": 1, "not-copy-ready": 0, archived: 0, deduplicated: 0 },
    excluded: [{ id: "excluded-001", reason: "invented-reason" }]
  };
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.join(root, "data/reports/migration-exclusions.json"), reportText);
  await writeJson(path.join(root, "data/reports/migration-summary.json"), {
    prompts: 1,
    collections: 1,
    proofs: 0,
    excluded: 1,
    exclusionReportSha256: exclusionReportDigest(report)
  });

  await assert.rejects(() => validateRepository(root), /exclusion reason/i);
});
