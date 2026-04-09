# Official MCP Registry Publish Notes

## Published record

- Registry name: `com.aurelianflo/core`
- Title: `AurelianFlo`
- Latest version published: `0.1.1`
- Latest published at: `2026-04-07T08:46:10.986595Z`
- Prior version: `0.1.0`
- Prior published at: `2026-04-06T22:59:27.142221Z`
- Registry API confirmation:
  `https://registry.modelcontextprotocol.io/v0.1/servers?search=com.aurelianflo/core`

## Metadata shipped

- Transport: `streamable-http`
- Remote endpoint: `https://x402.aurelianflo.com/mcp`
- Server card: `https://x402.aurelianflo.com/.well-known/mcp/server-card.json`
- Docs: `https://x402.aurelianflo.com/mcp/docs`
- Privacy: `https://x402.aurelianflo.com/mcp/privacy`
- Support: `https://x402.aurelianflo.com/mcp/support`
- Repository provenance:
  `https://github.com/kelm2021/aurelianflo`
- Repository subfolder:
  `apps/aurelianflo-mcp`

## Auth method used

- Method: HTTP domain authentication
- Domain used for login: `aurelianflo.com`
- Apex domain was attached to Vercel project `x402-data-bazaar` immediately before auth so the proof could be served from the required root-domain URL.
- Proof URL:
  `https://aurelianflo.com/.well-known/mcp-registry-auth`
- Active proof is also reachable on:
  `https://x402.aurelianflo.com/.well-known/mcp-registry-auth`
- Key algorithm: `ed25519`

## Local operational notes

- The current official publisher flow uses the registry release binary, not an npm install. On Windows:
  `https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_amd64.tar.gz`
- This repo now serves `GET /.well-known/mcp-registry-auth` from `MCP_REGISTRY_AUTH_PROOF`.
- The proof route now sends `Cache-Control: no-store, max-age=0` so proof rotations do not get stranded behind stale CDN cache.
- Production deploy used for the proof route:
  `https://x402-data-bazaar-gxkhfzlon-kents-projects-7e7b2348.vercel.app`
- The authoritative local key bundle is `outputs/mcp-registry/` and must remain uncommitted.
- Derive future proof/login material from the PEM instead of copying ad hoc JSON:
  `node scripts/mcp_registry_proof.js --key "outputs/mcp-registry/mcp-registry-auth-key.pem"`
- The registry currently enforces `description` length `<= 100`, so `server.json` uses the shortened published description.
- The saved publisher token currently decodes to HTTP auth on `aurelianflo.com` with publish permission for `com.aurelianflo/*`.
- A stale cached proof caused one failed re-login while multiple local key bundles existed. After aligning the production proof with the authoritative PEM bundle and disabling proof caching, fresh `login http` retries now succeed again.

## Verification completed

1. `test/mcp-route.test.js` passes locally with the new proof route.
2. `mcp-publisher validate` succeeds from `apps/aurelianflo-mcp/submission/`.
3. `node scripts/mcp_registry_proof.js --key "outputs/mcp-registry/mcp-registry-auth-key.pem"` reproduces the working proof and private seed from the authoritative PEM.
4. A fresh `mcp-publisher login http --domain aurelianflo.com --private-key ...` succeeds using the seed derived by the helper script.
5. A subsequent `0.1.1` metadata update was validated, republished, and accepted by the official registry.
6. The registry API returns both `0.1.0` and `0.1.1`, with `0.1.1` marked `isLatest: true`.
7. The saved publisher token decodes to `auth_method=http`, `auth_method_sub=aurelianflo.com`, and `resource=com.aurelianflo/*`.

## Downstream pickup status

- Official MCP Registry API: visible immediately after publish.
- Official MCP Registry web app: registry home reachable; API-confirmed listing is live.
- Glama direct server page check:
  `https://glama.ai/mcp/servers/com.aurelianflo/core`
  returned `404` immediately after publish.
- PulseMCP direct server page check:
  `https://pulsemcp.com/servers/com.aurelianflo/core`
  returned `403` to this automated check immediately after publish.
- Conclusion: official publication is complete; downstream aggregator ingestion still needs a later re-check.

## Version policy

- `0.1.0` and `0.1.1` are now consumed.
- Any further metadata change requires a new version, starting with `0.1.2`.

## Next registry update

- Candidate version: `0.1.2`
- Planned metadata refresh:
  move the remote endpoint from `https://x402.aurelianflo.com/mcp` to `https://api.aurelianflo.com/mcp`, keep repository provenance at `https://github.com/kelm2021/aurelianflo`, and refresh the shortened registry description plus docs/privacy/support links to the `api` host.
