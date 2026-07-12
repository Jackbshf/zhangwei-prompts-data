import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runOpenAIExecution } from "../src/proof-execution.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestArg = process.argv.find((item) => item.startsWith("--manifest="))?.slice(11);
if (!manifestArg || !process.argv.includes("--execute") || process.env.PROOF_PAID_EXECUTION !== "APPROVED") {
  throw new Error("Paid execution requires --manifest, --execute, and PROOF_PAID_EXECUTION=APPROVED.");
}
const manifest = JSON.parse(await readFile(path.resolve(root, manifestArg), "utf8"));
const outputs = await runOpenAIExecution(manifest, {
  apiKey: process.env.OPENAI_API_KEY,
  imageModel: process.env.OPENAI_IMAGE_MODEL,
  textModel: process.env.OPENAI_TEXT_MODEL
});
const outputDir = path.join(root, "output", "staging", `stage-${manifest.stageTarget}-batch-${manifest.batchId}`);
await mkdir(outputDir, { recursive: true });
const records = [];
for (const output of outputs) {
  const file = path.join(outputDir, `${output.id}.${output.extension}`);
  await writeFile(file, output.bytes, { flag: "wx" });
  records.push({
    id: output.id,
    modality: output.modality,
    file: path.relative(root, file).replaceAll("\\", "/"),
    mimeType: output.mimeType,
    bytes: output.bytes.length,
    sha256: createHash("sha256").update(output.bytes).digest("hex"),
    textLength: output.text?.length || null,
    qaStatus: "pending"
  });
}
await writeFile(path.join(outputDir, "staging-manifest.json"), `${JSON.stringify({
  stageTarget: manifest.stageTarget,
  batchId: manifest.batchId,
  outputs: records
}, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputDir, generated: records.length }, null, 2));
