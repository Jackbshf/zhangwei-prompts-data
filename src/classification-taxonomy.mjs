import { createHash } from "node:crypto";

export const CLASSIFICATION_TAXONOMY_VERSION = "classification-taxonomy-v1";

function clean(value) {
  return String(value ?? "").trim();
}

function categoryParts(category) {
  return clean(category).split("/").map(clean).filter(Boolean);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function deriveClassificationTaxonomy(classification = {}) {
  const category = clean(classification.category);
  const modality = clean(classification.modality);
  const useCase = clean(classification.useCase);
  const parts = categoryParts(category);
  const root = parts[0] || "";
  const fallback = useCase || category || modality || "未分类";

  let department = root || modality || fallback;
  let scenario = parts.length > 1 ? parts.at(-2) : fallback;
  let task = parts.length > 1 ? parts.at(-1) : fallback;

  if (root === "图像提示词") {
    department = "AI 视觉设计";
    scenario = parts[1] || fallback;
    task = useCase || parts[1] || fallback;
  } else if (root === "视频提示词") {
    department = "AI 视频创作";
    scenario = parts[1] || fallback;
    task = useCase || parts[1] || fallback;
  } else if (root === "影视提示词") {
    department = "影视创作";
    scenario = parts[1] || fallback;
    task = useCase || parts[1] || fallback;
  } else if (root === "影视") {
    department = "影视创作";
  }

  return {
    department: clean(department) || fallback,
    scenario: clean(scenario) || fallback,
    task: clean(task) || fallback
  };
}

export function applyClassificationTaxonomy(prompt) {
  const classification = prompt?.classification || {};
  return {
    ...prompt,
    classification: {
      ...classification,
      ...deriveClassificationTaxonomy(classification)
    }
  };
}

export function buildClassificationTaxonomyReport(prompts) {
  const rows = prompts.map((prompt) => ({
    id: clean(prompt.id),
    modality: clean(prompt.classification?.modality),
    ...deriveClassificationTaxonomy(prompt.classification)
  })).sort((left, right) => compareText(left.id, right.id));
  const departments = {};
  const modalities = {};

  for (const row of rows) {
    departments[row.department] = (departments[row.department] || 0) + 1;
    modalities[row.modality] = (modalities[row.modality] || 0) + 1;
  }

  const sortCounts = (counts) => Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => compareText(left, right))
  );
  const complete = rows.filter((row) => row.department && row.scenario && row.task).length;
  const classificationSha256 = createHash("sha256")
    .update(JSON.stringify(rows))
    .digest("hex");

  return {
    schemaVersion: 1,
    taxonomyVersion: CLASSIFICATION_TAXONOMY_VERSION,
    total: rows.length,
    complete,
    incomplete: rows.length - complete,
    departments: sortCounts(departments),
    modalities: sortCounts(modalities),
    classificationSha256
  };
}
