function clean(value) {
  return String(value ?? "").trim();
}

export const QUALITY_RUBRIC_VERSION = "prompt-quality-v3-structural";

function variableName(value) {
  return clean(value).replace(/^\{+/, "").replace(/\}+$/, "");
}

function referencedVariables(text) {
  return [...clean(text).matchAll(/\{\{?([^{}]+)\}\}?/g)].map((match) => variableName(match[1]));
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function modalityCoveragePatterns(modality) {
  if (modality === "图像") {
    return [
      /主体|产品|人物|对象/,
      /场景|背景|环境/,
      /构图|景别|镜头|视角/,
      /光影|光线|色彩|材质|纹理/,
      /风格|情绪|氛围/,
      /比例|画幅|横版|竖版|\d+\s*:\s*\d+/,
      /不要|避免|禁止|负面|无文字|水印/
    ];
  }
  if (modality === "视频") {
    return [
      /主体|产品|人物|对象/,
      /场景|背景|环境/,
      /动作|运动|变化|转场/,
      /镜头|运镜|景别|视角/,
      /\d+\s*秒|时长|节奏|中段|结尾|首帧|尾帧/,
      /一致|稳定|漂移|连续|闪烁|跳帧/,
      /比例|画幅|横版|竖版|\d+\s*:\s*\d+/,
      /不要|避免|禁止|负面|水印|随机文字/
    ];
  }
  return [
    /角色|你是|身份/,
    /背景|场景|目标|任务/,
    /步骤|流程|先.+再|执行/,
    /输出|格式|交付|成品/,
    /检查|质量|标准|判断/,
    /失败|修正|迭代|风险|边界/
  ];
}

function hasModalityToolMismatch(modality, tool) {
  if (modality === "图像") {
    return /(?:^|\b)(?:Google\s+Veo|Veo|Runway|Kling|Sora|Pika|Luma\s+Dream\s+Machine|Seedance)(?:\b|$)|可灵|即梦/.test(tool);
  }
  if (modality === "视频") {
    return /Midjourney|DALL-?E|GPT\s*Image|Adobe\s+Firefly|Canva\s+Magic\s+Media|Recraft|Stable\s+Diffusion|SDXL|(?:^|\b)FLUX(?:\b|$)/i.test(tool);
  }
  return false;
}

function variableUsability(prompt, body) {
  const names = Array.isArray(prompt.variables?.names) ? prompt.variables.names.map(variableName).filter(Boolean) : [];
  const defaults = prompt.variables?.defaults && typeof prompt.variables.defaults === "object" ? prompt.variables.defaults : {};
  const referenced = new Set(referencedVariables(body));
  let active = 0;
  let genericDefaults = 0;
  let populatedDefaults = 0;
  for (const name of names) {
    const value = clean(defaults[name]);
    if (value) populatedDefaults += 1;
    if (/^(待定|未填写|自定义|按需|无|n\/?a)$/i.test(value)) genericDefaults += 1;
    if (referenced.has(name) || (value && body.includes(value))) active += 1;
  }
  return {
    count: names.length,
    activeRatio: names.length ? active / names.length : 1,
    populatedRatio: names.length ? populatedDefaults / names.length : 1,
    genericRatio: names.length ? genericDefaults / names.length : 0
  };
}

function structuralDeductions(prompt, body, title, summary) {
  let deductions = 0;
  const modality = clean(prompt.classification?.modality);
  const task = clean(prompt.classification?.task || prompt.classification?.useCase);
  const tool = clean(prompt.model?.tool);

  if (body.length < 180) deductions += 4;
  else if (body.length < 280) deductions += 2;
  if (summary.length < 36) deductions += 2;
  if (task && !title.includes(task)) deductions += 1;
  if (task && !summary.includes(task)) deductions += 1;
  if (task && !body.includes(task)) deductions += 2;

  for (const pattern of modalityCoveragePatterns(modality)) {
    if (!pattern.test(body)) deductions += 1;
  }

  const variables = variableUsability(prompt, body);
  if (variables.count === 0) deductions += 2;
  if (variables.activeRatio < 0.5) deductions += 4;
  else if (variables.activeRatio < 0.8) deductions += 2;
  if (variables.populatedRatio === 0) deductions += 2;
  else if (variables.populatedRatio < 0.5) deductions += 1;
  if (variables.genericRatio >= 0.5) deductions += 3;
  else if (variables.genericRatio > 0) deductions += 1;

  if (clean(prompt.model?.name).toLowerCase() === "universal") deductions += 2;
  if (hasModalityToolMismatch(modality, tool)) deductions += 4;

  const rightsConfirmed = prompt.provenance?.rightsStatus === "confirmed"
    || prompt.proof?.rights?.status === "confirmed";
  if (!rightsConfirmed) deductions += 3;
  const source = clean(prompt.provenance?.source);
  if (/官方结构参考/.test(source) && !clean(prompt.provenance?.sourceUrl)) deductions += 2;

  const safetyPatterns = modality === "文本"
    ? [/风险|边界|合规|假设|事实|隐私|绝对化/]
    : [/不要|避免|禁止|负面|水印|品牌|安全/];
  if (!includesAny(body, safetyPatterns)) deductions += 2;
  return deductions;
}

export function reconcileVariableDeclarations(prompt) {
  const body = clean(prompt.content?.copyPrompt || prompt.content?.prompt);
  const names = Array.isArray(prompt.variables?.names) ? prompt.variables.names : [];
  const defaults = prompt.variables?.defaults && typeof prompt.variables.defaults === "object" ? prompt.variables.defaults : {};
  const declared = new Set(names.map(variableName));
  for (const name of referencedVariables(body)) {
    if (declared.has(name) || names.length >= 24) continue;
    names.push(`{${name}}`);
    declared.add(name);
    if (name === "画面比例" && clean(prompt.classification?.aspectRatio)) defaults[name] = clean(prompt.classification.aspectRatio);
  }
  prompt.variables = { names, defaults };
  return prompt;
}

export function assessPromptQuality(prompt, options = {}) {
  const issues = [];
  const title = clean(prompt.content?.title);
  const summary = clean(prompt.content?.summary);
  const body = clean(prompt.content?.copyPrompt || prompt.content?.prompt);
  const source = clean(prompt.provenance?.source).toLowerCase();
  const declared = new Set((prompt.variables?.names || []).map(variableName));
  const referenced = referencedVariables(body);

  if (title.length < 8 || /^(提示词|模板|prompt)$/i.test(title)) issues.push("content.title.too-generic");
  if (summary.length < 20) issues.push("content.summary.too-short");
  if (body.length < 60) issues.push("content.prompt.too-short");
  if (referenced.some((name) => !declared.has(name))) issues.push("variables.unresolved");
  if (!source || /^(unknown|legacy|待确认|未知)$/.test(source)) issues.push("provenance.source.unusable");
  if (!clean(prompt.model?.tool)) issues.push("model.tool.missing");
  if (prompt.publication?.copyReady !== true) issues.push("publication.copy-ready.required");

  const deductions = {
    "content.title.too-generic": 15,
    "content.summary.too-short": 15,
    "content.prompt.too-short": 25,
    "variables.unresolved": 25,
    "provenance.source.unusable": 20,
    "model.tool.missing": 15,
    "publication.copy-ready.required": 20
  };
  const blockingDeductions = issues.reduce((sum, issue) => sum + deductions[issue], 0);
  const score = Math.max(0, 100 - blockingDeductions - structuralDeductions(prompt, body, title, summary));
  return {
    status: score >= 85 && issues.length === 0 ? "passed" : "failed",
    rubricVersion: QUALITY_RUBRIC_VERSION,
    score,
    checkedAt: clean(options.checkedAt),
    issues
  };
}

export function qualityLevelForAssessment(assessment) {
  if (assessment.status !== "passed") return "quality-v3-failed";
  if (assessment.score >= 95) return "quality-v3-strong";
  if (assessment.score >= 90) return "quality-v3-ready";
  return "quality-v3-review";
}
