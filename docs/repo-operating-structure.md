# Repo Operating Structure

This repo now has two different jobs:

1. ship and measure the focused core wedge
2. keep a small set of legacy utilities alive without letting them hijack the roadmap

## Where Things Live

- `apps/restricted-party-screen`
  - the current core product
  - new strategic products should follow this pattern in `apps/`
- `routes/`
  - the legacy warehouse and route catalog
  - do not add new generic routes here
- `portfolio/`
  - the operating layer for classification, manifests, and seller strategy
- `docs/rebuild-blueprint.md`
  - strategy source of truth
- `docs/portfolio-classification.md`
  - current seller triage
- `docs/restricted-party-launch-status.md`
  - live status of the current core wedge

## Rules

- New strategic products go in `apps/`.
- Existing legacy sellers can stay live, but their scope is frozen.
- `legacy-kill` means freeze now and retire later when safe.
- The broad `x402-data-bazaar` identity is warehouse infrastructure, not the future product identity.
- Do not start wedge #2 until wedge #1 clears its market gates.

## Practical Workflow

1. use `npm run restricted-party-screen:test` for core product work
2. use `node scripts/list_seller_portfolio.js` to see strategic classification
3. use `node scripts/seller_manifest_report.js` to review the current keep/freeze/retire map
4. use `node scripts/portfolio_report.js` only to inform operations, not to justify new catalog sprawl
