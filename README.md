# ZhangWei Prompts Data

Public source of truth for the standalone ZhangWei prompt gallery.

## Repository layout

- `data/prompts/<shard>/<id>.json`: one canonical Prompt Schema v2 record per file; v1 conversion remains available for compatibility.
- `data/collections/*.json`: curated collection definitions.
- `data/proofs/generated/*.webp`: generated proof assets keyed by prompt ID.
- `data/proofs/manifest.json`: proof generation manifest.
- `schema/prompt-v1.schema.json`: public Prompt Schema v1 contract.
- `schema/prompt-v2.schema.json`: multimodal evidence, rights, quality, run, and QA contract.
- `data/reports/migration-exclusions.json`: reproducible legacy exclusion report.

## Commands

```powershell
npm.cmd test
npm.cmd run validate
npm.cmd run verify
npm.cmd run proofs:plan -- --stage=240 --batch-size=25
npm.cmd run proofs:execution-manifest -- --stage=240 --batch=001 --approval=output/approval-stage-240-batch-001.json
npm.cmd run proofs:dreamina-review -- --manifest=output/execution/stage-240-batch-001.json
```

The one-time migration reads the current gallery baseline and the legacy source without modifying either repository:

```powershell
npm.cmd run migrate
```

Set `PROMPTS_GALLERY_DIR` or `PROMPTS_LEGACY_DIR` only when the sibling repositories are stored elsewhere.

## Publishing contract

Changes reach this repository through pull requests. The gallery pins an exact data commit and generates its own deployable search index, detail shards, compatibility payload, and SEO pages. This repository never deploys the website.

## Proof execution gates

Proof plans are deterministic and limited to 25 items per batch. They never call paid providers. Image and text runs require an OpenAI key; video runs require the approval-gated Dreamina CLI workflow; media uploads require restricted R2 credentials. CI validates plans and manifests but must never hold paid-generation credentials.

OpenAI execution additionally requires `--execute` and `PROOF_PAID_EXECUTION=APPROVED`; output files use exclusive creation and never overwrite an existing result. Dreamina commands are emitted only as review packs with paid submission disabled until the exact batch is approved.
