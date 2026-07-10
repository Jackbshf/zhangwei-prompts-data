import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildExclusionReport, createExclusionReport, exclusionReportDigest } from "../src/migration.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspace = path.dirname(root);
const galleryRoot = process.env.PROMPTS_GALLERY_DIR || path.join(workspace, "zhangwei-prompts-gallery");
const legacyRoot = process.env.PROMPTS_LEGACY_DIR || path.join(workspace, "zhangwei-site-prompts-quality");
const publicPayload = JSON.parse(await readFile(path.join(galleryRoot, "public", "data", "prompts.json"), "utf8"));
const publishedIds = new Set((publicPayload.prompts || []).map((prompt) => prompt.id));
const inputs = await buildExclusionReport({
  legacyIndexPath: path.join(legacyRoot, "prompts-data", "search-index.json"),
  legacyLibraryPath: path.join(legacyRoot, "prompts-data", "library.json"),
  proofManifestPath: path.join(galleryRoot, "public", "proofs", "generated", "manifest.json")
});
const report = createExclusionReport(inputs.sourceEntries, publishedIds, inputs);
const reportPath = path.join(root, "data", "reports", "migration-exclusions.json");
const summaryPath = path.join(root, "data", "reports", "migration-summary.json");
await mkdir(path.dirname(reportPath), { recursive: true });
const reportText = `${JSON.stringify(report, null, 2)}\n`;
await writeFile(reportPath, reportText, "utf8");
const summary = JSON.parse(await readFile(summaryPath, "utf8"));
summary.exclusionReportSha256 = exclusionReportDigest(report);
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ excluded: report.excludedCount, counts: report.counts }, null, 2));
