import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  classifyExclusion,
  collectionPathForId,
  createExclusionReport,
  migrateDataset
} from "../src/migration.mjs";
import { promptPathForId } from "../src/prompt-schema.mjs";

test("classifyExclusion uses stable precedence for legacy exclusions", () => {
  const publishedIds = new Set(["published"]);

  assert.equal(classifyExclusion({ id: "paid", access: "paid" }, publishedIds), "not-free");
  assert.equal(classifyExclusion({ id: "uncopyable", access: "free", copyReady: false }, publishedIds), "not-copy-ready");
  assert.equal(classifyExclusion({ id: "archived", access: "free", archived: true }, publishedIds), "archived");
  assert.equal(classifyExclusion({ id: "duplicate", access: "free" }, publishedIds), "deduplicated");
  assert.equal(classifyExclusion({ id: "published", access: "free" }, publishedIds), null);
});

test("createExclusionReport accounts for every source record not in public baseline", () => {
  const source = [
    { id: "published", access: "free" },
    { id: "paid", access: "paid" },
    { id: "uncopyable", access: "free", copyReady: false },
    { id: "archived", access: "free", archived: true },
    { id: "duplicate", access: "free" }
  ];
  const report = createExclusionReport(source, new Set(["published"]));

  assert.equal(report.sourceCount, 5);
  assert.equal(report.publicCount, 1);
  assert.equal(report.excludedCount, 4);
  assert.deepEqual(report.counts, {
    "not-free": 1,
    "not-copy-ready": 1,
    archived: 1,
    deduplicated: 1
  });
  assert.equal(report.excluded.find((item) => item.id === "duplicate").duplicateOf, "published");
  assert.match(report.excluded.find((item) => item.id === "duplicate").signatureSha256, /^[0-9a-f]{64}$/);
});

test("createExclusionReport rejects source records without a stable id", () => {
  assert.throws(() => createExclusionReport([
    { id: "published", access: "free" },
    { title: "missing id", access: "free" }
  ], new Set(["published"])), /missing id/i);
});

test("createExclusionReport chooses the published winner regardless of source order", () => {
  const source = [
    { id: "winner", access: "free", category: "图像", promptPreview: "同一效果" },
    { id: "duplicate", access: "free", category: "图像", promptPreview: "同一效果" }
  ];
  const publishedIds = new Set(["winner"]);
  const forward = createExclusionReport(source, publishedIds);
  const reversed = createExclusionReport([...source].reverse(), publishedIds);

  assert.equal(forward.excluded[0].duplicateOf, "winner");
  assert.equal(reversed.excluded[0].duplicateOf, "winner");
  assert.equal(forward.excluded[0].signatureSha256, reversed.excluded[0].signatureSha256);
});

test("collectionPathForId rejects path traversal and Windows separators", () => {
  assert.throws(() => collectionPathForId("../escape"), /invalid collection id/i);
  assert.throws(() => collectionPathForId("folder\\escape"), /invalid collection id/i);
  assert.equal(collectionPathForId("visual-collection"), "data/collections/visual-collection.json");
});

test("migrateDataset writes prompt, collection, proof, and exclusion artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prompts-data-test-"));
  const input = path.join(root, "input");
  const output = path.join(root, "output");
  const proofs = path.join(input, "proofs");
  await mkdir(proofs, { recursive: true });

  const publicPrompt = {
    id: "proofed-001",
    title: "测试提示词",
    category: "图像",
    summary: "测试摘要",
    prompt: "测试正文",
    tool: "通用中文",
    modality: "图像",
    source: "测试来源",
    copyReady: true,
    featured: true,
    collectionIds: ["visual"],
    coverImageUrl: "/prompts/proofs/generated/proofed-001.webp",
    commercialProof: {
      type: "生成预览",
      model: "GPT Image",
      testedAt: "2026-07-11",
      resultNote: "测试证明",
      evidenceLevel: "generated-preview"
    }
  };

  await writeFile(path.join(input, "prompts.json"), JSON.stringify({
    generatedAt: "2026-07-11T00:00:00.000Z",
    collections: [{ id: "visual", title: "视觉", promptCount: 1 }],
    prompts: [publicPrompt]
  }));
  await writeFile(path.join(input, "search-index.json"), JSON.stringify({
    prompts: [
      { id: "proofed-001", access: "free" },
      { id: "paid-001", access: "paid" }
    ]
  }));
  await writeFile(path.join(input, "library.json"), JSON.stringify({ prompts: [] }));
  await writeFile(path.join(proofs, "proofed-001.webp"), "proof");
  await writeFile(path.join(input, "manifest.json"), JSON.stringify({ images: { "proofed-001": { coverImageUrl: publicPrompt.coverImageUrl } } }));

  const summary = await migrateDataset({
    publicDataPath: path.join(input, "prompts.json"),
    legacyIndexPath: path.join(input, "search-index.json"),
    legacyLibraryPath: path.join(input, "library.json"),
    proofsDir: proofs,
    proofManifestPath: path.join(input, "manifest.json"),
    outputRoot: output
  });

  assert.deepEqual(summary, { prompts: 1, collections: 1, proofs: 1, excluded: 1 });
  const migrated = JSON.parse(await readFile(path.join(output, promptPathForId("proofed-001")), "utf8"));
  assert.equal(migrated.content.title, "测试提示词");
  assert.equal(migrated.proof.assetPath, "proofs/generated/proofed-001.webp");
  const report = JSON.parse(await readFile(path.join(output, "data/reports/migration-exclusions.json"), "utf8"));
  assert.equal(report.counts["not-free"], 1);
  assert.equal(await readFile(path.join(output, "data/proofs/generated/proofed-001.webp"), "utf8"), "proof");

  await assert.rejects(() => migrateDataset({
    publicDataPath: path.join(input, "prompts.json"),
    legacyIndexPath: path.join(input, "search-index.json"),
    legacyLibraryPath: path.join(input, "library.json"),
    proofsDir: proofs,
    proofManifestPath: path.join(input, "manifest.json"),
    outputRoot: output
  }), /already exists/i);
});

test("migrateDataset does not leave final data after a failed migration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "prompts-data-atomic-test-"));
  const input = path.join(root, "input");
  const output = path.join(root, "output");
  await mkdir(input, { recursive: true });
  const prompt = {
    id: "missing-proof-001",
    title: "缺少证明图",
    category: "图像",
    summary: "摘要",
    prompt: "正文",
    tool: "通用中文",
    modality: "图像",
    source: "测试",
    coverImageUrl: "/prompts/proofs/generated/missing-proof-001.webp",
    commercialProof: { model: "GPT Image", testedAt: "2026-07-11", resultNote: "证明", evidenceLevel: "generated-preview" }
  };
  await writeFile(path.join(input, "prompts.json"), JSON.stringify({ prompts: [prompt], collections: [] }));
  await writeFile(path.join(input, "search-index.json"), JSON.stringify({ prompts: [{ id: prompt.id, access: "free" }] }));
  await writeFile(path.join(input, "library.json"), JSON.stringify({ prompts: [] }));
  await writeFile(path.join(input, "manifest.json"), JSON.stringify({ images: { [prompt.id]: { coverImageUrl: prompt.coverImageUrl } } }));

  await assert.rejects(() => migrateDataset({
    publicDataPath: path.join(input, "prompts.json"),
    legacyIndexPath: path.join(input, "search-index.json"),
    legacyLibraryPath: path.join(input, "library.json"),
    proofsDir: path.join(input, "proofs"),
    proofManifestPath: path.join(input, "manifest.json"),
    outputRoot: output
  }));
  await assert.rejects(() => access(path.join(output, "data")), { code: "ENOENT" });
});
