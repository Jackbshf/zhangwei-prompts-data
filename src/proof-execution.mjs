import { createHash } from "node:crypto";

function finiteLimit(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be a non-negative finite limit.`);
  return number;
}

function approvedProofInput(item, approvedInputs) {
  if (item.action === "review-existing") {
    return { prompt: item.sourcePrompt, inputSha256: "" };
  }
  const approved = approvedInputs?.[item.id];
  const prompt = String(approved?.prompt || "").trim();
  if (!prompt) throw new Error(`Missing approved proof input for ${item.id}.`);
  if (/\{\{[^{}]+\}\}|\{[^{}]+\}/.test(prompt)) {
    throw new Error(`Approved proof input contains an unresolved template variable: ${item.id}.`);
  }
  const digest = createHash("sha256").update(prompt).digest("hex");
  if (String(approved?.inputSha256 || "") !== digest) {
    throw new Error(`Approved proof input hash does not match for ${item.id}.`);
  }
  return { prompt, inputSha256: digest };
}

export function buildInputReviewPack(plan, batchId) {
  const batch = plan.batches?.find((item) => item.batchId === batchId);
  if (!batch) throw new Error(`Unknown proof batch: ${batchId}`);
  const items = batch.items
    .filter((item) => item.action === "generate")
    .map((item) => ({
      id: item.id,
      modality: item.modality,
      provider: item.provider,
      modelRole: item.modelRole,
      sourceModelTool: item.sourceModelTool || "",
      sourceModelName: item.sourceModelName || "",
      targetKey: item.targetKey,
      templateVariables: item.templateVariables || [],
      sourcePromptTemplate: item.sourcePromptTemplate || item.sourcePrompt,
      reviewStatus: "pending"
    }));
  const inputs = Object.fromEntries(items.map((item) => [item.id, { prompt: "", inputSha256: "" }]));
  return {
    version: "proof-input-review-pack-v2",
    stageTarget: plan.stageTarget,
    batchId,
    approvedForPaidExecution: false,
    instructions: "Replace all template variables, review the exact input, then record its SHA-256 before creating an execution manifest.",
    items,
    inputs
  };
}

export function createExecutionManifest(plan, batchId, approval = {}, costPlan = null, approvedInputs = {}) {
  if (approval.approved !== true) throw new Error("Paid proof work requires explicit approval.");
  if (!costPlan?.approvalReady || !costPlan.pricingSnapshot?.snapshotAt) {
    throw new Error("Paid proof work requires a complete pricing snapshot.");
  }
  const batch = plan.batches?.find((item) => item.batchId === batchId);
  if (!batch) throw new Error(`Unknown proof batch: ${batchId}`);
  const batchCost = costPlan.batches?.find((item) => item.batchId === batchId);
  if (Number(costPlan.stageTarget) !== Number(plan.stageTarget) || !batchCost) {
    throw new Error("Pricing snapshot does not match the requested stage and batch.");
  }
  if (Number(approval.stageTarget) !== Number(plan.stageTarget) || String(approval.batchId) !== String(batchId)) {
    throw new Error("Approval does not match the requested stage and batch.");
  }
  if (!String(approval.approvedAt || "").trim()) throw new Error("Approval must include approvedAt.");
  const maximumUsd = finiteLimit(approval.maximumUsd, "maximumUsd");
  const maximumDreaminaCredits = finiteLimit(approval.maximumDreaminaCredits, "maximumDreaminaCredits");
  const estimatedUsd = finiteLimit(batchCost.estimatedUsd, "estimatedUsd");
  const estimatedDreaminaCredits = finiteLimit(batchCost.estimatedDreaminaCredits, "estimatedDreaminaCredits");
  if (Number(approval.estimatedUsd) !== estimatedUsd || Number(approval.estimatedDreaminaCredits) !== estimatedDreaminaCredits) {
    throw new Error("Approval estimates do not match the pricing snapshot.");
  }
  if (estimatedUsd > maximumUsd || estimatedDreaminaCredits > maximumDreaminaCredits) {
    throw new Error("Estimated proof cost exceeds the approved limit.");
  }
  const tasks = batch.items.map((item) => {
    const approvedInput = approvedProofInput(item, approvedInputs);
    const base = {
      id: item.id,
      modality: item.modality,
      provider: item.provider,
      modelRole: item.modelRole,
      action: item.action,
      sourcePromptTemplate: item.sourcePromptTemplate || item.sourcePrompt,
      sourcePrompt: approvedInput.prompt,
      inputSha256: approvedInput.inputSha256,
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
    pricingSnapshot: costPlan.pricingSnapshot,
    modelLocks: costPlan.modelLocks,
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
  const completedIds = options.completedIds instanceof Set ? options.completedIds : new Set(options.completedIds || []);
  const openAITasks = manifest.tasks.filter((item) => (
    item.execution === "openai-api" && item.paidSubmissionAllowed && !completedIds.has(item.id)
  ));
  const needsImage = openAITasks.some((item) => item.modelRole === "image");
  const needsText = openAITasks.some((item) => item.modelRole === "text");
  if (openAITasks.length > 0 && (!options.apiKey || (needsImage && !options.imageModel) || (needsText && !options.textModel))) {
    throw new Error("OpenAI credentials and pinned models are required.");
  }
  if ((needsImage && options.imageModel !== manifest.modelLocks?.openaiImage)
    || (needsText && options.textModel !== manifest.modelLocks?.openaiText)) {
    throw new Error("Runtime model does not match the approved model lock.");
  }
  const fetchImpl = options.fetchImpl || fetch;
  const outputs = [];
  for (const task of openAITasks) {
    const isImage = task.modelRole === "image";
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
      const output = { id: task.id, modality: task.modality, mimeType: "image/png", extension: "png", bytes: Buffer.from(encoded, "base64") };
      if (options.onOutput) await options.onOutput(output, task);
      outputs.push(output);
    } else {
      const text = responseText(payload).trim();
      if (!text) throw new Error(`OpenAI text response is empty for ${task.id}`);
      const output = { id: task.id, modality: task.modality, mimeType: "text/plain", extension: "txt", text, bytes: Buffer.from(text, "utf8") };
      if (options.onOutput) await options.onOutput(output, task);
      outputs.push(output);
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
