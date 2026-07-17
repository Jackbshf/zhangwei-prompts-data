import path from "node:path";
import { fileURLToPath } from "node:url";

import { reassessPromptRepositoryQuality } from "../src/quality-reassessment.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checkedAtArg = process.argv.find((value) => value.startsWith("--checked-at="));
const checkedAt = checkedAtArg?.slice("--checked-at=".length) || process.env.QUALITY_CHECKED_AT;
const dryRun = process.argv.includes("--dry-run");

const result = await reassessPromptRepositoryQuality(root, { checkedAt, dryRun });
console.log(JSON.stringify({ dryRun, ...result }, null, 2));
