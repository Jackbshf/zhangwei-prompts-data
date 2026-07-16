import path from "node:path";

export function validatedCompletedIds(executionManifest, stagingManifest) {
  if (Number(stagingManifest.stageTarget) !== Number(executionManifest.stageTarget)
    || String(stagingManifest.batchId) !== String(executionManifest.batchId)) {
    throw new Error("Existing staging manifest belongs to a different stage or batch.");
  }
  const taskIds = new Set((executionManifest.tasks || [])
    .filter((task) => task.execution === "openai-api")
    .map((task) => task.id));
  const completedIds = new Set();
  for (const output of stagingManifest.outputs || []) {
    if (!taskIds.has(output.id)) throw new Error(`Staging output is not an OpenAI task in this batch: ${output.id}`);
    if (completedIds.has(output.id)) throw new Error(`Duplicate staging output: ${output.id}`);
    completedIds.add(output.id);
  }
  return completedIds;
}

export async function assertNoUntrackedStagingOutputs(executionManifest, completedIds, outputDir, exists) {
  for (const task of (executionManifest.tasks || []).filter((item) => item.execution === "openai-api" && !completedIds.has(item.id))) {
    for (const extension of ["png", "txt"]) {
      const file = path.join(outputDir, `${task.id}.${extension}`);
      if (await exists(file)) {
        throw new Error(`Untracked staging output already exists for ${task.id}; refusing a duplicate paid request.`);
      }
    }
  }
}
