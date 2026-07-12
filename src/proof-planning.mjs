const VERIFIED = new Set(["run-verified", "human-reviewed"]);

function modality(value) {
  if (value === "图像") return { name: value, provider: "openai", modelRole: "image" };
  if (value === "视频") return { name: value, provider: "dreamina", modelRole: "video" };
  return { name: "文本", provider: "openai", modelRole: "text" };
}

function priority(prompt) {
  let score = Number(prompt.publication?.qualityScore || 0);
  if (prompt.publication?.featured) score += 1000;
  if (prompt.proof?.status === "preview") score += 10000;
  return score;
}

export function buildProofStagePlan(prompts, options = {}) {
  const stageTarget = Number(options.stageTarget || 240);
  const batchSize = Number(options.batchSize || 25);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) throw new Error("Batch size must be between 1 and 25.");
  if (!Number.isInteger(stageTarget) || stageTarget < 1) throw new Error("Stage target must be a positive integer.");

  const candidates = prompts
    .filter((prompt) => !VERIFIED.has(prompt.proof?.status))
    .sort((left, right) => priority(right) - priority(left) || left.id.localeCompare(right.id, "en"))
    .slice(0, stageTarget)
    .map((prompt, index) => {
      const media = modality(prompt.classification?.modality);
      const reviewExisting = prompt.proof?.status === "preview" && media.name === "图像";
      return {
        index,
        id: prompt.id,
        title: prompt.content?.title || prompt.id,
        modality: media.name,
        provider: media.provider,
        modelRole: media.modelRole,
        action: reviewExisting ? "review-existing" : "generate",
        sourcePrompt: prompt.content?.copyPrompt || prompt.content?.prompt || "",
        targetKey: `proofs/v2/${prompt.id}/pending/${media.modelRole}`,
        overwriteAllowed: false
      };
    });

  const batches = [];
  for (let index = 0; index < candidates.length; index += batchSize) {
    const items = candidates.slice(index, index + batchSize);
    batches.push({
      batchId: String(batches.length + 1).padStart(3, "0"),
      approvalRequired: true,
      paidExecutionAllowed: false,
      items
    });
  }
  return {
    version: "proof-stage-plan-v2",
    stageTarget,
    batchSize,
    approvalRequired: true,
    items: candidates,
    batches,
    summary: {
      selected: candidates.length,
      reviewExisting: candidates.filter((item) => item.action === "review-existing").length,
      generate: candidates.filter((item) => item.action === "generate").length,
      image: candidates.filter((item) => item.modality === "图像").length,
      video: candidates.filter((item) => item.modality === "视频").length,
      text: candidates.filter((item) => item.modality === "文本").length
    }
  };
}
