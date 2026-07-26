import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicStatuses = new Set(["published", "published-no-image", "published-proofed"]);

const rules = {
  "ai-agent-workflow": /AI Agent|Agent 工作流|智能体|RAG|知识库问答|工具调用|状态机/i,
  "beauty-fashion-portrait": /美妆|妆容|护肤|服饰|服装|穿搭|时尚|人像|肖像|模特|珠宝/,
  "brand-campaign-visual": /品牌(?:主张|视觉|活动|广告)|品牌 KV|主视觉|海报|Campaign|广告 KV|宣传视觉/i,
  "business-writing-office": /商务邮件|会议纪要|周报|月报|汇报|工作总结|方案撰写|跨部门沟通|合同|行政|财务|法务/,
  "cinematic-single-shot": /电影感|电影级|影视视觉|单镜头|场景概念|分镜预演|镜头构图/,
  "ecommerce-product-hero": /product-hero|hero-image-selling|电商(?:产品|商品)?主图|商品主图|产品主图|主图卖点|高端产品主视觉|单品英雄图|产品英雄图|商品棚拍|产品棚拍|卖点视觉|详情页首屏|产品展示图/i,
  "growth-analysis-ops": /增长分析|投放复盘|数据分析|用户分层|活动复盘|私域转化|转化漏斗|运营复盘|指标诊断/,
  "short-video-commerce": /短视频(?:带货|商品种草|口播|脚本)|直播(?:带货|间口播|商品讲解)|信息流(?:广告|投放)|商品种草/,
  "social-content-studio": /小红书|社媒内容|社交媒体|账号定位|选题拆解|封面文案|标题.*标签|笔记(?:标题|正文)/,
  "video-motion-shot": /图生视频|视频运镜|镜头运动|运动控制|转场|循环动效|三段式|分镜版|单镜头版/
};
const modalityRules = {
  "beauty-fashion-portrait": new Set(["图像"]),
  "brand-campaign-visual": new Set(["图像"]),
  "cinematic-single-shot": new Set(["图像"]),
  "ecommerce-product-hero": new Set(["图像"]),
  "video-motion-shot": new Set(["视频"])
};

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function promptFiles() {
  const base = path.join(root, "data", "prompts");
  const files = [];
  for (const shard of (await readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
    for (const name of (await readdir(path.join(base, shard.name))).filter((item) => item.endsWith(".json"))) {
      files.push(path.join(base, shard.name, name));
    }
  }
  return files.sort();
}

function searchable(prompt) {
  return [
    prompt.id,
    prompt.content?.title,
    prompt.classification?.department,
    prompt.classification?.scenario,
    prompt.classification?.task,
    prompt.classification?.category,
    prompt.classification?.useCase
  ].filter(Boolean).join(" ");
}

const prompts = (await Promise.all((await promptFiles()).map(readJson)))
  .filter((prompt) => publicStatuses.has(prompt.publication?.status) && prompt.publication?.copyReady !== false);
const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
const collectionDir = path.join(root, "data", "collections");

for (const name of (await readdir(collectionDir)).filter((item) => item.endsWith(".json")).sort()) {
  const file = path.join(collectionDir, name);
  const collection = await readJson(file);
  const rule = rules[collection.id];
  const allowedModalities = modalityRules[collection.id];
  if (!rule) throw new Error(`Missing collection rule: ${collection.id}`);
  const members = prompts
    .filter((prompt) => rule.test(searchable(prompt)) && (!allowedModalities || allowedModalities.has(prompt.classification.modality)))
    .sort((left, right) =>
      Number(Boolean(right.proof)) - Number(Boolean(left.proof))
      || Number(right.publication.qualityScore || 0) - Number(left.publication.qualityScore || 0)
      || left.id.localeCompare(right.id)
    )
    .slice(0, 60);
  if (members.length < 5) throw new Error(`Collection ${collection.id} has only ${members.length} strict members.`);

  const memberIds = members.map((prompt) => prompt.id);
  const samplePrompts = members.slice(0, 5).map((prompt) => ({
    id: prompt.id,
    title: prompt.content.title,
    modality: prompt.classification.modality,
    tool: prompt.model.tool,
    qualityScore: prompt.publication.qualityScore
  }));
  const proofMember = members.find((prompt) => prompt.proof);
  const next = {
    ...collection,
    coverImageUrl: proofMember ? `/prompts/${proofMember.proof.assetPath}` : "",
    proofModel: proofMember?.proof?.model || "",
    proofType: proofMember ? "成员运行记录" : "结构已校验",
    promptCount: memberIds.length,
    promptIds: memberIds,
    samplePrompts
  };
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`${collection.id}: ${memberIds.length} members; cover ${proofMember?.id || "none"}`);
}

for (const collection of await Promise.all((await readdir(collectionDir)).filter((item) => item.endsWith(".json")).map((name) => readJson(path.join(collectionDir, name))))) {
  for (const id of collection.promptIds || []) {
    if (!byId.has(id)) throw new Error(`Collection ${collection.id} references missing prompt ${id}`);
  }
}
