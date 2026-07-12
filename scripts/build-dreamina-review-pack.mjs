import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestArg = process.argv.find((item) => item.startsWith("--manifest="))?.slice(11);
if (!manifestArg) throw new Error("--manifest=<path> is required.");
const manifest = JSON.parse(await readFile(path.resolve(root, manifestArg), "utf8"));
const tasks = manifest.tasks.filter((task) => task.execution === "dreamina-review-pack");
const outputDir = path.join(root, "output", "dreamina-review", `stage-${manifest.stageTarget}-batch-${manifest.batchId}`);
await mkdir(outputDir, { recursive: true });
for (const task of tasks) {
  const markdown = `# ${task.id}\n\n- 模态：视频\n- 状态：review-pending\n- 输出音频：${task.outputAudioPolicy}\n- 目标 R2 key：${task.targetKey}\n- 付费提交：禁止，等待审核\n\n## 即梦提示词\n\n${task.sourcePrompt}\n\n## CLI 预检\n\n${task.cliPreflight.map((line) => `- \`${line}\``).join("\n")}\n\n## 命令计划\n\n\`${task.commandTemplate}\`\n`;
  await writeFile(path.join(outputDir, `${task.id}.md`), markdown, { encoding: "utf8", flag: "wx" });
}
await writeFile(path.join(outputDir, "review-manifest.json"), `${JSON.stringify({
  stageTarget: manifest.stageTarget,
  batchId: manifest.batchId,
  approval: manifest.approval,
  paidSubmissionAllowed: false,
  tasks
}, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
console.log(JSON.stringify({ outputDir, reviewTasks: tasks.length }, null, 2));
