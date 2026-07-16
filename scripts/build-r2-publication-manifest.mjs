import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildR2PublicationManifest } from "../src/proof-publication.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const value = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
const executionPath = value("execution");
const stagingPath = value("staging");
if (!executionPath || !stagingPath) throw new Error("--execution=<path> and --staging=<path> are required.");

const [execution, staging] = await Promise.all([
  readFile(path.resolve(root, executionPath), "utf8").then(JSON.parse),
  readFile(path.resolve(root, stagingPath), "utf8").then(JSON.parse)
]);
const manifest = buildR2PublicationManifest(execution, staging);
const outputDir = path.join(root, "output", "publication");
const outputFile = path.join(outputDir, `stage-${manifest.stageTarget}-batch-${manifest.batchId}.json`);
await mkdir(outputDir, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputFile, summary: manifest.summary, publicationStatus: manifest.publicationStatus }, null, 2));
