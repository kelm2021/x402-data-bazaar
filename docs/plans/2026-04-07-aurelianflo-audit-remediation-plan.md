# AurelianFlo Audit Remediation Implementation Plan

> **For Codex:** Use this plan only after the user approves the remediation scope. Execute with one lead integrator plus parallel worker lanes. Do not let multiple agents edit `app.js` at the same time.

**Goal:** Turn the April 7, 2026 AurelianFlo business audit into a concrete remediation program that fixes narrative drift, MCP metadata friction, documentation inconsistency, and buyer confusion while respecting the API surface cut already shipped to production on April 7, 2026.

**Architecture:** Treat the audit as a positioning and metadata-alignment project first. The biggest surface-area fix is already live: production full discovery now uses a 31-route AurelianFlo allowlist and non-whitelisted `/api/*` routes return `404` in production. The remaining work is to align homepage copy, discovery descriptions, MCP metadata, README/submission docs, and manifest language with the actual public surface. Defer any second surface cut or breaking MCP tool consolidation until after an explicit product decision.

**Tech Stack:** Node.js, Express, existing root seller app, `apps/aurelianflo-mcp`, static JSON manifests, Markdown submission docs, current Node test suites

---

## What Changed Since The Audit

### Confirmed Production Change
- The broad mixed-catalog problem described in the audit is no longer the current production state.
- Production `full` discovery now resolves to a 31-route AurelianFlo allowlist.
- Non-whitelisted `/api/*` endpoints return `404` in production instead of staying live but merely hidden from discovery.
- The current allowlist explicitly keeps compliance, vendor diligence, simulation, finance workflows, and document generation.

### Evidence In Repo
- `C:\Users\KentEgan\claude projects\x402-data-bazaar\app.js`
- `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\generated-auto-local.test.js`
- `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\payment.test.js`
- `C:\Users\KentEgan\claude projects\x402-data-bazaar\docs\2026-04-07-aurelianflo-api-surface-cut.md`

### Implication
- "Suppress the giant public route dump" is no longer a primary implementation task.
- The current problem is now narrower and more important: the product story still does not match the public surface cleanly.

---

## Audit Review

### Findings That Still Stand
- The homepage copy is weak and jargon-heavy.
- The `App` nav link still creates product confusion by sending users to `https://wrap.aurelianflo.com`.
- MCP tool descriptions still contain buyer-unfriendly phrasing and incorrect `destructiveHint` usage.
- Public docs still expose internal implementation details and Windows-local links.
- Privacy and support submission docs still read like drafts.
- Description drift still exists across homepage, MCP server card, README, manifest, seller configs, and submission files.

### Findings That Are Now Stale Or Reframed
- The audit's "317-route public sprawl" finding is stale for production.
- The audit's "vendor, finance, and XLSX are phantom capabilities" claim is no longer a discovery bug. Those capabilities are now deliberate members of the production allowlist.
- The product question is no longer "why are these routes leaking?" It is "does the retained 31-route surface represent the intended AurelianFlo offer?"

### Recommendation
- Default recommendation: accept the current 31-route production surface as the working AurelianFlo offer for Wave 1.
- Rewrite narrative and metadata to fit that surface.
- Keep the option open for a second deliberate narrowing cut later if you want AurelianFlo repositioned around a tighter compliance-only core.
- Defer breaking MCP tool consolidation to a follow-on wave with deprecation coverage.

---

## Delivery Model

This plan is optimized for parallel execution after one serial extraction pass that creates clean ownership boundaries.

### Recommended Agent Count
- `1` lead integrator
- `4` worker agents

### Lead Responsibilities
- own the serial extraction and all `app.js` edits
- define the canonical AurelianFlo description set
- lock the product-positioning choice for Wave 1
- review any compatibility-sensitive changes
- merge worker lanes
- run full verification

### Worker Lane Boundaries
- Lane A: homepage narrative, audience framing, and CTA content
- Lane B: discovery and manifest language alignment
- Lane C: MCP tool metadata and server-card cleanup
- Lane D: README, submission docs, and brand consistency cleanup

### Lead-Only Files
- `C:\Users\KentEgan\claude projects\x402-data-bazaar\app.js`
- `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\generated-auto-local.test.js`
- `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\payment.test.js`
- `C:\Users\KentEgan\claude projects\x402-data-bazaar\docs\plans\2026-04-07-aurelianflo-audit-remediation-plan.md`

Do not let multiple agents edit `app.js` in parallel.

---

## Approval Gates Before Coding

### Decision 1: Wave 1 Product Frame

Choose one of these and lock it before dispatching workers.

**Recommended:** Accept the current 31-route surface
- AurelianFlo is a paid API for compliance screening, vendor diligence, Monte Carlo decision analysis, finance scenario workflows, and formatted document output for AI agents.
- This keeps the current production surface intact and fixes the story around it.

**Alternative:** Prepare for a second narrowing cut
- AurelianFlo is a compliance-first product with only supporting simulation and document tools.
- This requires a separate surface-reduction project after Wave 1 cleanup.

### Decision 2: Wrapped Product Link
- Recommended action: remove `App` from the primary nav in Wave 1.
- Fallback action: rename it to `Wrapped` and move it to secondary navigation or footer context.

### Decision 3: MCP Consolidation
- Recommended Wave 1 action: keep the current 9-tool interface but fix names, descriptions, and `destructiveHint`.
- Recommended Wave 2 action: deprecate redundant tools and then collapse to the 6-tool surface after compatibility review.

---

## Target File Layout

### New Shared Modules For Parallelism
- Create: `C:\Users\KentEgan\claude projects\x402-data-bazaar\lib\aurelianflo-profile.js`
- Create: `C:\Users\KentEgan\claude projects\x402-data-bazaar\lib\aurelianflo-surface.js`
- Create: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\aurelianflo-profile.test.js`
- Create: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\aurelianflo-surface.test.js`

### Discovery And Brand Touch Points
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\well-known-x402-aurelian.json`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\restricted-party-screen\seller.config.json`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\vendor-entity-brief\seller.config.json`

### MCP Package Touch Points
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\src\tool-catalog.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\src\server-card.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\README.md`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\submission\server.json`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\submission\privacy-policy.md`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\submission\support.md`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\test\tool-catalog.test.mjs`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\test\server-card.test.mjs`

### Root-App Integration Touch Points
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\app.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\generated-auto-local.test.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\payment.test.js`

---

## Wave 0: Serial Extraction

Lead-only. Complete this before dispatching workers.

### Task 1: Extract canonical AurelianFlo profile copy out of `app.js`

**Files:**
- Create: `C:\Users\KentEgan\claude projects\x402-data-bazaar\lib\aurelianflo-profile.js`
- Create: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\aurelianflo-profile.test.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\app.js`

**Steps:**
1. Define canonical full, medium, and short descriptions for the approved Wave 1 product frame.
2. Define homepage lede, audience framing, value proposition, CTA labels, and a jargon-replacement map in one module.
3. Replace hard-coded AurelianFlo marketing copy in `app.js` with imports from the profile module.
4. Add tests that lock:
   - canonical short description
   - homepage lede
   - removal of `onchain compliance` and `premium reporting` from exported copy

**Verification Commands:**
- `node --test test/aurelianflo-profile.test.js`

### Task 2: Extract the current production surface and discovery labels out of `app.js`

**Files:**
- Create: `C:\Users\KentEgan\claude projects\x402-data-bazaar\lib\aurelianflo-surface.js`
- Create: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\aurelianflo-surface.test.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\app.js`

**Steps:**
1. Move `AURELIANFLO_ALLOWED_ROUTE_KEYS` into the new surface module without changing membership.
2. Move public-core discovery route labels and manifest-resource helpers into the same module.
3. Replace scattered in-file AurelianFlo surface declarations in `app.js` with imports from the surface module.
4. Add tests that lock:
   - the 31-route allowlist
   - presence of retained vendor, finance, and XLSX routes
   - continued exclusion of weather, stocks, generic utilities, and other removed routes

**Verification Commands:**
- `node --test test/aurelianflo-surface.test.js`

Dispatch workers only after both extraction tasks pass.

---

## Wave 1: Parallel Worker Lanes

### Lane A: Homepage Narrative And CTA Cleanup

**Owner:** Worker A

**Files:**
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\lib\aurelianflo-profile.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\aurelianflo-profile.test.js`

**Scope:**
- audience framing
- value proposition
- quickstart CTA language
- jargon replacement map
- nav label decisions as exported config only

**Do Not Touch:**
- `app.js`
- manifest JSON
- MCP package files

**Steps:**
1. Add failing tests for required homepage content:
   - target audience line
   - value proposition line
   - quickstart CTA
2. Replace jargon phrases in the exported copy set.
3. Define the approved nav copy contract:
   - no `App` in primary nav, or
   - renamed `Wrapped` secondary label if the lead chooses the fallback
4. Keep wording consistent with the canonical short and medium descriptions.
5. Run the profile tests until green.

**Verification Commands:**
- `node --test test/aurelianflo-profile.test.js`

---

### Lane B: Discovery And Manifest Language Alignment

**Owner:** Worker B

**Files:**
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\lib\aurelianflo-surface.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\well-known-x402-aurelian.json`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\aurelianflo-surface.test.js`

**Scope:**
- surface labels
- public resource descriptions
- well-known manifest language
- keep the current allowlist unless the lead explicitly changes it

**Do Not Touch:**
- `app.js`
- MCP package files
- README and submission docs

**Steps:**
1. Add failing tests for manifest-resource alignment with the current allowlist.
2. Rewrite manifest description and instructions so they describe the retained 31-route surface accurately.
3. Remove stale wording that implies hidden phantom capabilities or a broader generic marketplace.
4. Keep resource membership aligned with the actual allowlist.
5. Run the surface tests until green.

**Verification Commands:**
- `node --test test/aurelianflo-surface.test.js`

---

### Lane C: MCP Metadata Cleanup

**Owner:** Worker C

**Files:**
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\src\tool-catalog.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\src\server-card.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\test\tool-catalog.test.mjs`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\test\server-card.test.mjs`

**Scope:**
- tool descriptions
- `destructiveHint` cleanup
- server-card description alignment
- no breaking tool removals in Wave 1

**Do Not Touch:**
- `app.js`
- root manifest
- README and submission docs

**Steps:**
1. Add failing tests for the four tools that currently misuse `destructiveHint`.
2. Rewrite descriptions to remove:
   - `premium`
   - `one paid call`
   - `shared AurelianFlo report model`
   - unclear jargon where a simpler phrase exists
3. Align the server-card description with the canonical medium description for the approved Wave 1 frame.
4. Keep all current tool names in place for compatibility.
5. Run MCP tests until green.

**Verification Commands:**
- `node --test apps/aurelianflo-mcp/test/tool-catalog.test.mjs`
- `node --test apps/aurelianflo-mcp/test/server-card.test.mjs`

---

### Lane D: README, Submission Docs, And Brand Cleanup

**Owner:** Worker D

**Files:**
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\README.md`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\submission\server.json`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\submission\privacy-policy.md`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\aurelianflo-mcp\submission\support.md`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\restricted-party-screen\seller.config.json`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\apps\vendor-entity-brief\seller.config.json`

**Scope:**
- public-facing docs only
- remove Windows-local links
- finalize draft language
- brand consistency across seller configs

**Do Not Touch:**
- `app.js`
- manifest JSON
- MCP tool logic

**Steps:**
1. Replace Windows-local Markdown links with repo-relative or published HTTPS links.
2. Remove low-level architecture notes from the public README.
3. Rewrite README examples to describe capabilities cleanly and avoid unnecessary internal route dumping.
4. Finalize privacy and support docs with non-draft wording and concrete public references.
5. Update `apps\vendor-entity-brief\seller.config.json` to use the umbrella AurelianFlo brand.
6. Keep `apps\restricted-party-screen\seller.config.json` aligned with the same canonical positioning.

**Verification Commands:**
- `node --test apps/aurelianflo-mcp/test/server-card.test.mjs`

---

## Wave 2: Serial Integration

Lead-only after all worker lanes return.

### Task 3: Rewire the root site to use the extracted profile and surface modules

**Files:**
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\app.js`

**Steps:**
1. Import the approved profile and surface modules.
2. Replace the current AurelianFlo homepage lede and section copy.
3. Remove or rename the `App` nav item according to the approved decision.
4. Ensure `/api`, `/api/system/discovery/core`, `/api/system/discovery/full`, `.well-known`, and MCP docs all use consistent labeling for the actual public surface.
5. Preserve the current allowlist behavior unless the user explicitly approves a second cut.

**Verification Commands:**
- `node --test test/aurelianflo-profile.test.js`
- `node --test test/aurelianflo-surface.test.js`

### Task 4: Reconcile discovery and OpenAPI assertions with the approved product frame

**Files:**
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\generated-auto-local.test.js`
- Modify: `C:\Users\KentEgan\claude projects\x402-data-bazaar\test\payment.test.js`

**Steps:**
1. Replace stale assertions that assume a compliance-only story if they conflict with the approved Wave 1 frame.
2. Keep assertions that enforce:
   - removed routes still return `404` in production
   - retained routes remain discoverable
   - manifest and OpenAPI wording match the approved canonical descriptions
3. Do not relax the production-takedown coverage.

**Verification Commands:**
- `node --test test/generated-auto-local.test.js`
- `node --test test/payment.test.js`

---

## Wave 3: Verification

Lead-only.

### Task 5: Run the affected verification suite

**Commands:**
- `node --test test/aurelianflo-profile.test.js`
- `node --test test/aurelianflo-surface.test.js`
- `node --test test/generated-auto-local.test.js`
- `node --test test/payment.test.js`
- `node --test apps/aurelianflo-mcp/test/tool-catalog.test.mjs`
- `node --test apps/aurelianflo-mcp/test/server-card.test.mjs`

### Task 6: Manual spot-check list

**Checks:**
- homepage lede now names the buyer and value proposition
- primary nav no longer routes unsuspecting users to Wrapped
- `/api` and `.well-known` describe the retained AurelianFlo surface accurately
- removed routes still return `404` in production
- MCP server card, README, submission docs, and homepage share the same canonical description family
- privacy and support docs no longer read as drafts

---

## Deferred Wave: Optional Second Surface Cut

Do not include these changes in the first implementation wave unless the user explicitly re-scopes the product.

### Deferred Item 1: Second Product Narrowing
- decide whether vendor, finance, and XLSX remain first-class AurelianFlo surface areas
- if not, run a second deliberate allowlist reduction and update all discovery, OpenAPI, and paid canaries accordingly

### Deferred Item 2: MCP Tool Consolidation
- collapse `ofac_wallet_report` into `ofac_wallet_screen` with `output_format`
- collapse `monte_carlo_decision_report` into `monte_carlo_report` with `output_format`
- replace `report_pdf_generate` and `report_docx_generate` with `report_generate`
- add deprecation notes and compatibility tests before any rename or removal

---

## Suggested Agent Briefs

### Lead Integrator Brief
You own the serial extraction, all `app.js` edits, and final verification. Start by extracting `lib\aurelianflo-profile.js` and `lib\aurelianflo-surface.js`, plus tests, so the worker lanes can operate without touching `app.js`. Preserve the existing 31-route allowlist unless the user explicitly approves a second narrowing cut.

### Worker A Brief
You own homepage messaging only. Edit `lib\aurelianflo-profile.js` and `test\aurelianflo-profile.test.js`. Do not touch `app.js`, manifests, or MCP files. Your job is to define audience framing, value proposition, CTA copy, and jargon replacements consistent with the approved Wave 1 product frame.

### Worker B Brief
You own discovery and manifest language only. Edit `lib\aurelianflo-surface.js`, `well-known-x402-aurelian.json`, and `test\aurelianflo-surface.test.js`. Do not touch `app.js` or MCP files. Your job is to make the retained production surface understandable, not to silently change its scope.

### Worker C Brief
You own MCP metadata only. Edit `apps\aurelianflo-mcp\src\tool-catalog.js`, `apps\aurelianflo-mcp\src\server-card.js`, and related tests. Do not rename or delete tools in this wave. Your job is to clean descriptions and remove incorrect `destructiveHint` usage.

### Worker D Brief
You own public docs and brand consistency only. Edit the MCP README, submission docs, and seller configs. Remove Windows-local links and draft wording. Keep public docs aligned with the canonical medium description.

---

## Success Criteria

The first remediation wave is complete when all of the following are true:
- AurelianFlo has one canonical full, medium, and short description used consistently.
- The homepage clearly states audience, value, and next step.
- The primary nav no longer confuses users with the Wrapped product.
- Buyer-facing discovery, `.well-known`, README, server card, and submission docs accurately describe the current production surface.
- Removed routes remain removed in production.
- MCP tool descriptions are cleaner and no longer misuse `destructiveHint`.
- README and submission docs are public-ready and no longer expose local-path noise or unresolved draft text.
- No breaking MCP tool renames or removals have shipped in Wave 1.
