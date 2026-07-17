import path from "node:path";
import { fileURLToPath } from "node:url";

import { migratePromptRepositoryToV2 } from "../src/schema-v2-migration.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checkedAtArg = process.argv.find((value) => value.startsWith("--checked-at="));
const checkedAt = checkedAtArg?.slice("--checked-at=".length) || process.env.PROOF_CHECKED_AT;

const result = await migratePromptRepositoryToV2(root, { checkedAt });
console.log(JSON.stringify(result, null, 2));
