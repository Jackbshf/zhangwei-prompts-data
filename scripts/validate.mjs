import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRepository } from "../src/repository-validation.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const result = await validateRepository(root, {
  expectedPrompts: 4167,
  expectedCollections: 10,
  expectedProofs: Number(process.env.EXPECTED_PROOFS || 138),
  expectedExcluded: 1375
});

console.log(JSON.stringify(result, null, 2));
