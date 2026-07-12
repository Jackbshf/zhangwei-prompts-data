function finiteLimit(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative finite limit.`);
  return number;
}

export function createExecutionManifest(plan, batchId, approval = {}) {
  if (approval.approved !== true) throw new Error("Paid proof work requires explicit approval.");
  const batch = plan.batches?.find((item) => item.batchId === batchId);
  if (!batch) throw new Error(`Unknown proof batch: ${batchId}`);
  if (Number(approval.stageTarget) !== Number(plan.stageTarget) || String(approval.batchId) !== String(batchId)) {
    throw new Error("Approval does not match the requested stage and batch.");
  }
  const maximumUsd = finiteLimit(approval.maximumUsd, "maximumUsd");
  const maximumDreaminaCredits = finiteLimit(approval.maximumDreaminaCredits, "maximumDreaminaCredits");
  const estimatedUsd = finiteLimit(approval.estimatedUsd, "estimatedUsd");
  const estimatedDreaminaCredits = finiteLimit(approval.estimatedDreaminaCredits, "estimatedDreaminaCredits");
  if (estimatedUsd > maximumUsd || estimatedDreaminaCredits > maximumDreaminaCredits) {
    throw new Error("Estimated proof cost exceeds the approved limit.");
  }
  const tasks = batch.items.map((item) => {
    const base = {
      id: item.id,
      modality: item.modality,
      provider: item.provider,
      action: item.action,
      sourcePrompt: item.sourcePrompt,
      targetKey: item.targetKey,
      overwriteAllowed: false
    };
    if (item.action === "review-existing") {
      return { ...base, execution: "local-review", paidSubmissionAllowed: false };
    }
    if (item.provider === "dreamina") {
      return {
        ...base,
        execution: "dreamina-review-pack",
        paidSubmissionAllowed: false,
        cliPreflight: ["dreamina -h", "dreamina text2video -h", "dreamina user_credit"],
        commandTemplate: "dreamina text2video --prompt-file <approved-prompt> --duration=4 --model_version=seedance2.0_vip --video_resolution=1080p",
        outputAudioPolicy: "visual-only/no-audio"
      };
    }
    return {
      ...base,
      execution: "openai-api",
      paidSubmissionAllowed: true,
      endpoint: item.modelRole === "image" ? "/v1/images/generations" : "/v1/responses",
      modelEnvironmentVariable: item.modelRole === "image" ? "OPENAI_IMAGE_MODEL" : "OPENAI_TEXT_MODEL"
    };
  });
  return {
    version: "proof-execution-manifest-v2",
    stageTarget: plan.stageTarget,
    batchId,
    approval: {
      approved: true,
      approvedAt: String(approval.approvedAt || ""),
      maximumUsd,
      maximumDreaminaCredits,
      estimatedUsd,
      estimatedDreaminaCredits
    },
    tasks
  };
}

function responseText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
}

export async function runOpenAIExecution(manifest, options = {}) {
  if (manifest?.approval?.approved !== true) throw new Error("OpenAI execution requires an approved manifest.");
  if (!options.apiKey || !options.imageModel || !options.textModel) throw new Error("OpenAI credentials and pinned models are required.");
  const fetchImpl = options.fetchImpl || fetch;
  const outputs = [];
  for (const task of manifest.tasks.filter((item) => item.execution === "openai-api" && item.paidSubmissionAllowed)) {
    const isImage = task.modality === "图像";
    const endpoint = isImage ? "/v1/images/generations" : "/v1/responses";
    const body = isImage
      ? { model: options.imageModel, prompt: task.sourcePrompt, size: "1536x1024", response_format: "b64_json" }
      : { model: options.textModel, input: task.sourcePrompt };
    const response = await fetchImpl(`https://api.openai.com${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`OpenAI proof generation failed for ${task.id}: HTTP ${response.status}`);
    if (isImage) {
      const encoded = payload.data?.[0]?.b64_json;
      if (!encoded) throw new Error(`OpenAI image response missing b64_json for ${task.id}`);
      outputs.push({ id: task.id, modality: task.modality, mimeType: "image/png", extension: "png", bytes: Buffer.from(encoded, "base64") });
    } else {
      const text = responseText(payload).trim();
      if (!text) throw new Error(`OpenAI text response is empty for ${task.id}`);
      outputs.push({ id: task.id, modality: task.modality, mimeType: "text/plain", extension: "txt", text, bytes: Buffer.from(text, "utf8") });
    }
  }
  return outputs;
}

export function validateProofOutput(output) {
  const fields = [];
  if (!/^[0-9a-f]{64}$/.test(String(output.sha256 || ""))) fields.push("sha256");
  if (!Number.isInteger(output.bytes) || output.bytes <= 0) fields.push("bytes");
  if (!String(output.mimeType || "")) fields.push("mimeType");
  if (["图像", "视频"].includes(output.modality)) {
    if (!Number.isInteger(output.width) || output.width <= 0) fields.push("width");
    if (!Number.isInteger(output.height) || output.height <= 0) fields.push("height");
  }
  if (output.modality === "视频" && (!Number.isInteger(output.durationMs) || output.durationMs < 4000 || output.durationMs > 6000)) {
    fields.push("durationMs");
  }
  if (output.modality === "文本" && (!Number.isInteger(output.textLength) || output.textLength < 20)) fields.push("textLength");
  return fields;
}
