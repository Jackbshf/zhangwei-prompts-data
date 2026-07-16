const SHA256 = /^[0-9a-f]{64}$/;

function extensionFor(file) {
  const match = String(file || "").match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

export function buildR2PublicationManifest(executionManifest, stagingManifest) {
  if (Number(stagingManifest.stageTarget) !== Number(executionManifest.stageTarget)
    || String(stagingManifest.batchId) !== String(executionManifest.batchId)) {
    throw new Error("Staging manifest belongs to a different execution batch.");
  }
  const tasks = new Map((executionManifest.tasks || []).map((task) => [task.id, task]));
  const assets = [];
  const keys = new Set();
  for (const output of stagingManifest.outputs || []) {
    const task = tasks.get(output.id);
    if (!task) throw new Error(`Staging output has no execution task: ${output.id}`);
    if (output.qaStatus !== "passed") throw new Error(`R2 publication requires a QA-passed output: ${output.id}`);
    const extension = extensionFor(output.file);
    if (!extension || !SHA256.test(String(output.sha256 || "")) || !Number.isInteger(output.bytes) || output.bytes <= 0) {
      throw new Error(`Staging output metadata is incomplete: ${output.id}`);
    }
    const key = `${String(task.targetKey || "").replace(/\/$/, "")}/${output.sha256}.${extension}`;
    if (!task.targetKey || keys.has(key)) throw new Error(`Duplicate or missing R2 publication target: ${output.id}`);
    keys.add(key);
    assets.push({
      id: output.id,
      sourceFile: output.file,
      key,
      url: `/prompts/media/${key}`,
      mimeType: output.mimeType,
      bytes: output.bytes,
      sha256: output.sha256,
      inputSha256: task.inputSha256,
      overwriteAllowed: false,
      cacheControl: "public, max-age=31536000, immutable"
    });
  }
  return {
    version: "proof-r2-publication-manifest-v2",
    stageTarget: executionManifest.stageTarget,
    batchId: executionManifest.batchId,
    publicationStatus: "upload-pending",
    assets,
    summary: { assets: assets.length, bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0) }
  };
}

export async function assertPublicationTargetsAbsent(publicationManifest, objectExists) {
  for (const asset of publicationManifest.assets || []) {
    if (await objectExists(asset.key)) throw new Error(`R2 publication target already exists: ${asset.key}`);
  }
}
