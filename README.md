# ZhangWei Prompts Data

Public source of truth for the standalone ZhangWei prompt gallery.

## Repository layout

- `data/prompts/<shard>/<id>.json`: one canonical Prompt Schema v1 record per file.
- `data/collections/*.json`: curated collection definitions.
- `data/proofs/generated/*.webp`: generated proof assets keyed by prompt ID.
- `data/proofs/manifest.json`: proof generation manifest.
- `schema/prompt-v1.schema.json`: public Prompt Schema v1 contract.
- `data/reports/migration-exclusions.json`: reproducible legacy exclusion report.

## Commands

```powershell
npm.cmd test
npm.cmd run validate
npm.cmd run verify
```

The one-time migration reads the current gallery baseline and the legacy source without modifying either repository:

```powershell
npm.cmd run migrate
```

Set `PROMPTS_GALLERY_DIR` or `PROMPTS_LEGACY_DIR` only when the sibling repositories are stored elsewhere.

## Publishing contract

Changes reach this repository through pull requests. The gallery pins an exact data commit and generates its own deployable search index, detail shards, compatibility payload, and SEO pages. This repository never deploys the website.
