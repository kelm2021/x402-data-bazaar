# AurelianFlo

## Description

AurelianFlo is a remote MCP server for compliance screening, vendor due diligence, Monte Carlo decision analysis, and formatted document output for AI agents.

- enhanced due diligence memos for counterparty and wallet review workflows
- batch OFAC wallet screening with review signals
- single-wallet OFAC screening with report output
- Monte Carlo decision reporting
- PDF, DOCX, and XLSX report generation

This package uses `x402-mcp` for paid MCP tools and exposes a streamable HTTP MCP endpoint with a static server card at `/.well-known/mcp/server-card.json`.

## Features

- `server_capabilities` as a free connection and capability check
- `edd_report` for enhanced due diligence memos with case metadata, evidence summary, required follow-up, and JSON, PDF, or DOCX output
- `batch_wallet_screen` for batch OFAC wallet screening with per-wallet results, review signals, and structured output
- `ofac_wallet_report` for bundled wallet screening with JSON, PDF, or DOCX output
- `ofac_wallet_screen` for exact-match OFAC wallet screening
- `monte_carlo_report` for simulation reporting with JSON, PDF, or DOCX output
- `monte_carlo_decision_report` for structured simulation reports
- `report_pdf_generate` for report PDFs
- `report_docx_generate` for report DOCX artifacts
- Streamable HTTP MCP endpoint with a static server card at `/.well-known/mcp/server-card.json`
- AgentCash-compatible discovery flow for the production origin

## Setup

1. Install dependencies with `npm install`
2. Set `AURELIANFLO_MCP_RECIPIENT` or `WALLET_ADDRESS`
3. Optionally set `X402_FACILITATOR_URL`
4. Start the server with `npm start`
5. Deploy the server behind HTTPS before submitting to Anthropic or Smithery

Environment variables:

- `AURELIANFLO_MCP_RECIPIENT` or `WALLET_ADDRESS`
- optional `X402_FACILITATOR_URL`
- optional `AURELIANFLO_MCP_NETWORK` (`base` by default)
- optional `AURELIANFLO_MCP_UPSTREAM_BASE_URL` to point at a separate upstream instead of the in-repo app
- optional `PORT` for the HTTP listener

## Authentication

Two supported access modes are available:

- Direct origin: `https://x402.aurelianflo.com/mcp`
- Smithery-hosted gateway: `https://core--aurelianflo.run.tools`

The direct origin does not require end-user OAuth authentication. Payment authorization is handled per tool through x402.

The Smithery-hosted gateway uses Smithery's connection and authorization flow. OAuth-capable clients should follow the authorization URL returned by the hosted gateway when it responds with `auth_required`.

## Examples

### Example 0: Free server check

User prompt: `Call server_capabilities and show me how this server is meant to be used.`

What happens:

- Claude calls `server_capabilities`
- The server returns direct and Smithery-hosted connection modes
- The response identifies which tools are free and which require x402 payment

### Example 1: EDD memo workflow

User prompt: `Prepare an enhanced due diligence memo for this counterparty wallet set and tell me what follow-up the reviewer still needs to complete.`

What happens:

- Claude calls `edd_report`
- The server runs the live enhanced due diligence workflow
- The result returns case metadata, review status labels, evidence summary, required follow-up, and either structured JSON or a generated PDF or DOCX artifact based on `output_format`

### Example 2: Batch OFAC screening workflow

User prompt: `Screen these three deposit wallets for OFAC exposure and tell me which ones require manual review.`

What happens:

- Claude calls `batch_wallet_screen`
- The server runs the live batch wallet screening workflow
- The result returns per-wallet screening results, total screened, match count, clear count, and a batch-level review signal that operations can hand off to a human reviewer
- The structured report payload can then be rendered with `report_pdf_generate` or `report_docx_generate` for audit handoff

### Example 3: Bundled OFAC wallet screening report

User prompt: `Screen 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 for OFAC sanctions and give me a PDF I can hand off.`

What happens:

- Claude calls `ofac_wallet_report`
- The server runs the live wallet screening route and then returns either structured JSON or a PDF or DOCX artifact from the same screening result
- The result includes exact hits, sanctioned entity metadata, source freshness, and the generated report output

### Example 4: Direct wallet screening JSON

User prompt: `Screen 0x098B716B8Aaf21512996dC57EB0615e2383E2f96 and return the JSON report only.`

What happens:

- Claude calls `ofac_wallet_screen`
- The server returns exact wallet screening data plus the structured report payload for downstream use

### Example 5: Bundled Monte Carlo report

User prompt: `Generate a compare-style decision report for a baseline and candidate launch scenario and return a PDF.`

What happens:

- Claude calls `monte_carlo_report`
- The server runs the live simulation report workflow
- The response returns either structured JSON or a PDF or DOCX artifact from the same simulation result

### Example 6: Monte Carlo building blocks

User prompt: `Generate a compare-style decision report payload and then render it to DOCX.`

What happens:

- Claude calls `monte_carlo_decision_report`
- The server returns the structured report payload
- Claude can then call `report_docx_generate` or `report_pdf_generate` as a second step

## Privacy Policy

The publication-ready privacy policy is in [submission/privacy-policy.md](./submission/privacy-policy.md).

## Support

The publication-ready support details are in [submission/support.md](./submission/support.md).

## Registry Submission

The official MCP Registry metadata is in [submission/server.json](./submission/server.json).

Official registry publish notes are in [submission/official-registry-publish.md](./submission/official-registry-publish.md).

## Public Production URLs

- Origin: `https://x402.aurelianflo.com`
- API catalog: `https://x402.aurelianflo.com/api`
- EDD route docs: `https://x402.aurelianflo.com/api/workflows/compliance/edd-report`
- Batch route docs: `https://x402.aurelianflo.com/api/workflows/compliance/batch-wallet-screen`
- MCP endpoint: `https://x402.aurelianflo.com/mcp`
- Server card: `https://x402.aurelianflo.com/.well-known/mcp/server-card.json`
- Docs: `https://x402.aurelianflo.com/mcp/docs`
- Privacy: `https://x402.aurelianflo.com/mcp/privacy`
- Support: `https://x402.aurelianflo.com/mcp/support`

## Codex Setup

Recommended direct install:

```bash
codex mcp add aurelianflo --url https://x402.aurelianflo.com/mcp
```

Smithery listing:

```bash
smithery mcp add aurelianflo/core
```

Smithery-hosted gateway:

```bash
codex mcp add aurelianflo-core --url https://core--aurelianflo.run.tools
```

Windows note:

- Smithery's `--client codex` handoff can fail on Windows even when the MCP server is healthy.
- If that happens, add the hosted gateway or the direct origin with `codex mcp add ... --url ...` instead of relying on the Smithery installer handoff.
- If the client does not support Smithery's hosted OAuth flow, use the direct origin.

## AgentCash Lane

Keep the existing AgentCash stdio flow alongside this MCP server for auto-discovery and HTTP payment handling against the production origin:

```bash
npx agentcash install --client codex
npx agentcash discover https://x402.aurelianflo.com
```

Verified locally on April 5, 2026:

- `npx agentcash` starts the AgentCash MCP server
- `npx agentcash install --client <client>` installs the stdio MCP config
- `npx agentcash discover https://x402.aurelianflo.com` discovers the live AurelianFlo origin
