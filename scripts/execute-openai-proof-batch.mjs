import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runOpenAIExecution } from "../src/proof-execution.mjs";
import { assertNoUntrackedStagingOutputs, validatedCompletedIds } from "../src/proof-staging.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestArg = process.argv.find((item) => item.startsWith("--manifest="))?.slice(11);
if (!manifestArg || !process.argv.includes("--execute") || process.env.PROOF_PAID_EXECUTION !== "APPROVED") {
  throw new Error("Paid execution requires --manifest, --execute, and PROOF_PAID_EXECUTION=APPROVED.");
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

const manifest = JSON.parse(await readFile(path.resolve(root, manifestArg), "utf8"));
const outputDir = path.join(root, "output", "staging", `stage-${manifest.stageTarget}-batch-${manifest.batchId}`);
const stagingManifestFile = path.join(outputDir, "staging-manifest.json");
await mkdir(outputDir, { recursive: true });
let staging = {
  stageTarget: manifest.stageTarget,
  batchId: manifest.batchId,
  outputs: []
};
if (await exists(stagingManifestFile)) {
  staging = JSON.parse(await readFile(stagingManifestFile, "utf8"));
  if (Number(staging.stageTarget) !== Number(manifest.stageTarget) || String(staging.batchId) !== String(manifest.batchId)) {
    throw new Error("Existing staging manifest belongs to a different stage or batch.");
  }
}
const completedIds = validatedCompletedIds(manifest, staging);
for (const record of staging.outputs) {
  const file = path.resolve(root, record.file);
  if (!await exists(file)) throw new Error(`Completed staging record is missing its file: ${record.id}`);
}
await assertNoUntrackedStagingOutputs(manifest, completedIds, outputDir, exists);

const outputs = await runOpenAIExecution(manifest, {
  apiKey: process.env.OPENAI_API_KEY,
  imageModel: process.env.OPENAI_IMAGE_MODEL,
  textModel: process.env.OPENAI_TEXT_MODEL,
  completedIds,
  onOutput: async (output) => {
    const file = path.join(outputDir, `${output.id}.${output.extension}`);
    await writeFile(file, output.bytes, { flag: "wx" });
    staging.outputs.push({
      id: output.id,
      modality: output.modality,
      file: path.relative(root, file).replaceAll("\\", "/"),
      mimeType: output.mimeType,
      bytes: output.bytes.length,
      sha256: createHash("sha256").update(output.bytes).digest("hex"),
      textLength: output.text?.length || null,
      qaStatus: "pending"
    });
    await writeFile(stagingManifestFile, `${JSON.stringify(staging, null, 2)}\n`, "utf8");
  }
});
console.log(JSON.stringify({
  outputDir,
  generatedThisRun: outputs.length,
  completed: staging.outputs.length
}, null, 2));
