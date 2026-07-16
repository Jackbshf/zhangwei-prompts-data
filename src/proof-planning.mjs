const VERIFIED = new Set(["run-verified", "human-reviewed"]);
const OPENAI_IMAGE_TOOLS = new Set(["ChatGPT / GPT Image", "DALL-E"]);

export const PILOT_TARGET_MIX = Object.freeze({
  reviewExistingImage: 95,
  generateImage: 102,
  generateText: 37,
  generateVideo: 6
});

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

function sourcePrompt(prompt) {
  return prompt.content?.copyPrompt || prompt.content?.prompt || "";
}

function templateVariables(value) {
  const variables = [];
  const seen = new Set();
  const matcher = /\{\{([^{}]+)\}\}|\{([^{}]+)\}/g;
  for (const match of String(value || "").matchAll(matcher)) {
    const name = String(match[1] || match[2] || "").trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      variables.push(name);
    }
  }
  return variables;
}

function inputTemplateKind(prompt) {
  if (prompt.classification?.modality !== "图像") return "structured-template";
  const value = sourcePrompt(prompt);
  const metaPrompt = /你是一名|输出一条可直接用于图像模型|You are an assistant|Write an image prompt/i.test(value);
  return metaPrompt ? "meta-image-prompt" : "direct-image";
}

function generationPriority(prompt) {
  const direct = inputTemplateKind(prompt) === "direct-image" ? 1_000_000 : 0;
  const compatible = OPENAI_IMAGE_TOOLS.has(prompt.model?.tool) ? 100_000 : 0;
  return direct + compatible + priority(prompt);
}

function sortCandidates(prompts, scorer = priority) {
  return [...prompts].sort((left, right) => scorer(right) - scorer(left) || left.id.localeCompare(right.id, "en"));
}

function lockedTargetMix(stageTarget, requested) {
  const mix = requested || (stageTarget === 240 ? PILOT_TARGET_MIX : null);
  if (!mix) return null;
  const normalized = {
    reviewExistingImage: Number(mix.reviewExistingImage),
    generateImage: Number(mix.generateImage),
    generateText: Number(mix.generateText),
    generateVideo: Number(mix.generateVideo)
  };
  if (Object.values(normalized).some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("Locked target mix values must be non-negative integers.");
  }
  const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
  if (total !== stageTarget) throw new Error(`Locked target mix totals ${total}, expected ${stageTarget}.`);
  return normalized;
}

function selectLockedCandidates(prompts, targetMix) {
  const groups = {
    reviewExistingImage: sortCandidates(prompts.filter((prompt) => prompt.classification?.modality === "图像" && prompt.proof?.status === "preview")),
    generateImage: sortCandidates(
      prompts.filter((prompt) => prompt.classification?.modality === "图像" && !prompt.proof),
      generationPriority
    ),
    generateText: sortCandidates(prompts.filter((prompt) => prompt.classification?.modality === "文本" && prompt.proof?.status === "preview")),
    generateVideo: sortCandidates(prompts.filter((prompt) => prompt.classification?.modality === "视频" && prompt.proof?.status === "preview"))
  };
  for (const [key, required] of Object.entries(targetMix)) {
    if (groups[key].length < required) {
      throw new Error(`Cannot satisfy locked target mix for ${key}: required ${required}, found ${groups[key].length}.`);
    }
  }
  const selected = [
    ...groups.reviewExistingImage.slice(0, targetMix.reviewExistingImage).map((prompt) => ({ prompt, selectionReason: "legacy-image-review" })),
    ...groups.generateText.slice(0, targetMix.generateText).map((prompt) => ({ prompt, selectionReason: "legacy-text-rerun" })),
    ...groups.generateVideo.slice(0, targetMix.generateVideo).map((prompt) => ({ prompt, selectionReason: "legacy-video-rerun" })),
    ...groups.generateImage.slice(0, targetMix.generateImage).map((prompt) => ({ prompt, selectionReason: "new-image-generation" }))
  ];
  return {
    selected,
    replacementImages: groups.generateImage
      .slice(targetMix.generateImage, targetMix.generateImage + targetMix.reviewExistingImage)
  };
}

function planItem(entry, index, stageTarget) {
  const prompt = entry.prompt;
  const media = modality(prompt.classification?.modality);
  const reviewExisting = entry.selectionReason === "legacy-image-review";
  const promptTemplate = sourcePrompt(prompt);
  return {
    index,
    id: prompt.id,
    title: prompt.content?.title || prompt.id,
    modality: media.name,
    provider: media.provider,
    modelRole: media.modelRole,
    action: reviewExisting ? "review-existing" : "generate",
    selectionReason: entry.selectionReason,
    sourceEvidence: reviewExisting ? "legacy-proof-manifest" : "canonical-prompt-data",
    sourceModelTool: prompt.model?.tool || "",
    sourceModelName: prompt.model?.name || "",
    inputTemplateKind: inputTemplateKind(prompt),
    templateVariables: templateVariables(promptTemplate),
    inputApprovalRequired: !reviewExisting,
    sourcePromptTemplate: promptTemplate,
    sourcePrompt: promptTemplate,
    targetKey: `proofs/v2/${prompt.id}/stage-${stageTarget}/${media.modelRole}`,
    overwriteAllowed: false
  };
}

function buildBatches(items, batchSize) {
  const batchCount = Math.ceil(items.length / batchSize);
  const baseSize = Math.floor(items.length / batchCount);
  const largerBatches = items.length % batchCount;
  const batches = [];
  let offset = 0;
  for (let index = 0; index < batchCount; index += 1) {
    const size = baseSize + (index < largerBatches ? 1 : 0);
    const batchItems = items.slice(offset, offset + size);
    offset += size;
    batches.push({
      batchId: String(index + 1).padStart(3, "0"),
      approvalRequired: true,
      paidExecutionAllowed: false,
      costEstimate: {
        status: "pricing-required",
        currency: "USD",
        openaiUsd: null,
        dreaminaCredits: null,
        estimatedR2Bytes: null
      },
      items: batchItems
    });
  }
  return batches;
}

export function buildProofStagePlan(prompts, options = {}) {
  const stageTarget = Number(options.stageTarget || 240);
  const batchSize = Number(options.batchSize || 25);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 25) throw new Error("Batch size must be between 1 and 25.");
  if (!Number.isInteger(stageTarget) || stageTarget < 1) throw new Error("Stage target must be a positive integer.");

  const unverified = prompts.filter((prompt) => !VERIFIED.has(prompt.proof?.status));
  const targetMix = lockedTargetMix(stageTarget, options.targetMix);
  let selected;
  let replacementImages = [];
  if (targetMix) {
    ({ selected, replacementImages } = selectLockedCandidates(unverified, targetMix));
  } else {
    selected = sortCandidates(unverified).slice(0, stageTarget).map((prompt) => ({
      prompt,
      selectionReason: prompt.proof?.status === "preview" && prompt.classification?.modality === "图像"
        ? "legacy-image-review"
        : "priority-generation"
    }));
  }

  const items = selected.map((entry, index) => planItem(entry, index, stageTarget));
  const batches = buildBatches(items, batchSize);
  const replacementItems = replacementImages.map((prompt, index) => planItem({
    prompt,
    selectionReason: "legacy-image-replacement"
  }, items.length + index, stageTarget));
  return {
    version: "proof-stage-plan-v2",
    stageTarget,
    batchSize,
    targetMix,
    approvalRequired: true,
    items,
    batches,
    replacementReserve: {
      imageIds: replacementItems.map((item) => item.id),
      items: replacementItems,
      purpose: "Replace legacy image reviews that fail provenance or quality gates.",
      overwriteAllowed: false
    },
    summary: {
      selected: items.length,
      reviewExisting: items.filter((item) => item.action === "review-existing").length,
      generate: items.filter((item) => item.action === "generate").length,
      image: items.filter((item) => item.modality === "图像").length,
      video: items.filter((item) => item.modality === "视频").length,
      text: items.filter((item) => item.modality === "文本").length
    }
  };
}

export function buildReplacementPlan(plan, audit) {
  const failedReviews = (plan.items || []).filter((item) => {
    if (item.selectionReason !== "legacy-image-review") return false;
    const entry = audit?.entries?.[item.id];
    return entry?.eligibility === "regenerate-required" || entry?.humanStatus === "failed";
  });
  const reserve = plan.replacementReserve?.items || [];
  if (failedReviews.length > reserve.length) {
    throw new Error(`Replacement reserve exhausted: required ${failedReviews.length}, available ${reserve.length}.`);
  }
  const items = failedReviews.map((failed, index) => ({
    ...reserve[index],
    index,
    selectionReason: "legacy-image-replacement",
    replacesProofId: failed.id,
    replacementReason: [...(audit.entries[failed.id]?.blockers || [])].join(","),
    overwriteAllowed: false
  }));
  return {
    version: "proof-replacement-plan-v2",
    stageTarget: plan.stageTarget,
    sourcePlanVersion: plan.version,
    approvalRequired: true,
    items,
    batches: buildBatches(items, plan.batchSize || 25),
    summary: {
      failedLegacyReviews: failedReviews.length,
      replacementsScheduled: items.length,
      reserveRemaining: reserve.length - items.length
    }
  };
}
