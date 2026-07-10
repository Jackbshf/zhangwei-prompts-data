import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrateDataset } from "../src/migration.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workspace = path.dirname(root);
const galleryRoot = process.env.PROMPTS_GALLERY_DIR || path.join(workspace, "zhangwei-prompts-gallery");
const legacyRoot = process.env.PROMPTS_LEGACY_DIR || path.join(workspace, "zhangwei-site-prompts-quality");

const summary = await migrateDataset({
  publicDataPath: path.join(galleryRoot, "public", "data", "prompts.json"),
  legacyIndexPath: path.join(legacyRoot, "prompts-data", "search-index.json"),
  legacyLibraryPath: path.join(legacyRoot, "prompts-data", "library.json"),
  proofsDir: path.join(galleryRoot, "public", "proofs", "generated"),
  proofManifestPath: path.join(galleryRoot, "public", "proofs", "generated", "manifest.json"),
  outputRoot: root
});

const expected = { prompts: 4167, collections: 10, proofs: 138, excluded: 1375 };
for (const [key, value] of Object.entries(expected)) {
  if (summary[key] !== value) {
    throw new Error(`Migration ${key} mismatch: expected ${value}, received ${summary[key]}`);
  }
}

console.log(JSON.stringify(summary, null, 2));
