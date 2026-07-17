function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function estimateInputTokens(text) {
  return Math.max(1, Math.ceil(Buffer.byteLength(String(text || ""), "utf8") / 3));
}

function roundCost(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function buildCostPlan(plan, pricing = {}) {
  const modelLocks = {
    openaiImage: String(pricing.modelLocks?.openaiImage || ""),
    openaiText: String(pricing.modelLocks?.openaiText || ""),
    dreaminaVideo: String(pricing.modelLocks?.dreaminaVideo || "")
  };
  const rates = {
    imageUsdPerOutput: positiveNumber(pricing.rates?.imageUsdPerOutput),
    textUsdPerMillionInputTokens: positiveNumber(pricing.rates?.textUsdPerMillionInputTokens),
    textUsdPerMillionOutputTokens: positiveNumber(pricing.rates?.textUsdPerMillionOutputTokens),
    textMaximumOutputTokens: positiveNumber(pricing.rates?.textMaximumOutputTokens),
    dreaminaCreditsPerVideo: positiveNumber(pricing.rates?.dreaminaCreditsPerVideo)
  };
  const sourceUrls = Array.isArray(pricing.sourceUrls) ? pricing.sourceUrls.filter(Boolean).map(String) : [];
  const missing = [];
  if (!String(pricing.snapshotAt || "").trim()) missing.push("snapshotAt");
  if (!sourceUrls.length) missing.push("sourceUrls");
  for (const [key, value] of Object.entries(modelLocks)) if (!value) missing.push(`modelLocks.${key}`);
  for (const [key, value] of Object.entries(rates)) if (value === null) missing.push(`rates.${key}`);

  const batches = (plan.batches || []).map((batch) => {
    const counts = { review: 0, image: 0, text: 0, video: 0 };
    let textInputTokens = 0;
    for (const item of batch.items || []) {
      if (item.action === "review-existing") counts.review += 1;
      else if (item.modelRole === "image") counts.image += 1;
      else if (item.modelRole === "text") {
        counts.text += 1;
        textInputTokens += estimateInputTokens(item.sourcePrompt);
      } else if (item.modelRole === "video") counts.video += 1;
    }
    const estimatedUsd = rates.imageUsdPerOutput === null
      || rates.textUsdPerMillionInputTokens === null
      || rates.textUsdPerMillionOutputTokens === null
      || rates.textMaximumOutputTokens === null
      ? null
      : roundCost(
        counts.image * rates.imageUsdPerOutput
        + textInputTokens * rates.textUsdPerMillionInputTokens / 1_000_000
        + counts.text * rates.textMaximumOutputTokens * rates.textUsdPerMillionOutputTokens / 1_000_000
      );
    const estimatedDreaminaCredits = rates.dreaminaCreditsPerVideo === null
      ? null
      : counts.video * rates.dreaminaCreditsPerVideo;
    return {
      batchId: batch.batchId,
      counts,
      estimatedTextInputTokens: textInputTokens,
      estimatedUsd,
      estimatedDreaminaCredits,
      estimatedStaticAssetBytes: null,
      pricingComplete: estimatedUsd !== null && estimatedDreaminaCredits !== null && missing.length === 0
    };
  });
  return {
    version: "proof-cost-plan-v2",
    stageTarget: plan.stageTarget,
    approvalReady: missing.length === 0 && batches.every((batch) => batch.pricingComplete),
    missing,
    pricingSnapshot: {
      snapshotAt: String(pricing.snapshotAt || ""),
      sourceUrls,
      rates
    },
    modelLocks,
    batches,
    summary: {
      estimatedUsd: batches.some((batch) => batch.estimatedUsd === null)
        ? null
        : roundCost(batches.reduce((sum, batch) => sum + batch.estimatedUsd, 0)),
      estimatedDreaminaCredits: batches.some((batch) => batch.estimatedDreaminaCredits === null)
        ? null
        : batches.reduce((sum, batch) => sum + batch.estimatedDreaminaCredits, 0),
      estimatedStaticAssetBytes: null
    }
  };
}
