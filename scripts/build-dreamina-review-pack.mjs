import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const value = (name) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
const stage = value("stage") || "240";
const manifestArg = value("manifest");
const planArg = value("plan") || `output/proof-stage-${stage}-plan.json`;
const costPlanArg = value("cost-plan") || `output/stage-${stage}-cost-plan.json`;
let tasks;
let approval;
let stageTarget;
if (manifestArg) {
  const manifest = JSON.parse(await readFile(path.resolve(root, manifestArg), "utf8"));
  tasks = manifest.tasks.filter((task) => task.execution === "dreamina-review-pack");
  approval = manifest.approval;
  stageTarget = manifest.stageTarget;
} else {
  const plan = JSON.parse(await readFile(path.resolve(root, planArg), "utf8"));
  tasks = plan.items
    .filter((item) => item.modelRole === "video" && item.action === "generate")
    .map((item) => ({
      ...item,
      execution: "dreamina-review-pack",
      paidSubmissionAllowed: false,
      cliPreflight: ["dreamina -h", "dreamina text2video -h", "dreamina user_credit"],
      commandTemplate: "dreamina text2video --prompt-file <approved-prompt> --duration=4 --model_version=seedance2.0_vip --video_resolution=1080p",
      outputAudioPolicy: "visual-only/no-audio"
    }));
  approval = { approved: false, reason: "Review pack only; paid generation is not authorized." };
  stageTarget = plan.stageTarget;
}
const costPlan = await readFile(path.resolve(root, costPlanArg), "utf8").then(JSON.parse).catch(() => null);
const videoBatchCosts = (costPlan?.batches || []).filter((batch) => batch.counts?.video > 0);
const outputDir = path.join(root, "output", "dreamina-review", `stage-${stageTarget}`);
await mkdir(outputDir, { recursive: true });
for (const task of tasks) {
  const markdown = `# ${task.id}

- 模态：视频
- 状态：review-pending
- 输出音频：${task.outputAudioPolicy}
- 目标 R2 key：${task.targetKey}
- 付费提交：禁止，等待审核

## 即梦提示词

${task.sourcePrompt}

## CLI 预检

${task.cliPreflight.map((line) => `- \`${line}\``).join("\n")}

## 命令计划

\`${task.commandTemplate}\`
`;
  await writeFile(path.join(outputDir, `${task.id}.md`), markdown, "utf8");
}
await writeFile(path.join(outputDir, "review-manifest.json"), `${JSON.stringify({
  version: "dreamina-review-pack-v2",
  stageTarget,
  approval,
  pricingReady: costPlan?.approvalReady === true,
  videoBatchCosts,
  paidSubmissionAllowed: false,
  cliStatus: "preflight-required",
  tasks
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputDir,
  reviewTasks: tasks.length,
  pricingReady: costPlan?.approvalReady === true,
  paidSubmissionAllowed: false
}, null, 2));
