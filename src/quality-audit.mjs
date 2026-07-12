function clean(value) {
  return String(value ?? "").trim();
}

function variableName(value) {
  return clean(value).replace(/^\{+/, "").replace(/\}+$/, "");
}

function referencedVariables(text) {
  return [...clean(text).matchAll(/\{\{?([^{}]+)\}\}?/g)].map((match) => variableName(match[1]));
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
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + deductions[issue], 0));
  return {
    status: score >= 85 && issues.length === 0 ? "passed" : "failed",
    rubricVersion: "prompt-quality-v2",
    score,
    checkedAt: clean(options.checkedAt),
    issues
  };
}
