# Clean Domain Rebuild Design

## Goal

Rebuild AurelianFlo from a clean codebase instead of layering more patches onto the broken mixed UI/API deployment. The target topology is:

- `aurelianflo.com` serves the product UI only
- `api.aurelianflo.com` serves the API, MCP, OpenAPI, and machine-readable metadata only
- `x402.aurelianflo.com` redirects to `https://aurelianflo.com`

## Current Problems On Clean Base (`3169006`)

- The root Next app imports UI pages and CSS from `web/src/app/*`, but that source tree is not tracked in git on this branch.
- The backend still treats `https://x402.aurelianflo.com` as the canonical base URL.
- The backend root and MCP docs still emit `x402.aurelianflo.com` links.
- The current deployment shape lets UI and machine surfaces bleed into each other.

## Rebuild Approach

### Backend/API lane

Keep the root project as the backend/API service. The backend must own:

- `/api`
- `/openapi.json`
- `/mcp`
- `/.well-known/mcp/server-card.json`
- `/.well-known/x402-aurelian.json`

Required behavior:

- canonical base URL defaults to `https://api.aurelianflo.com`
- `GET /` on the API host returns machine-readable JSON, not HTML
- MCP/help text and emitted links use `api.aurelianflo.com`
- `x402.aurelianflo.com` is not required as an API origin

Primary code control points:

- `app.js`
- `app/page.tsx` or a host-aware root proxy if needed

### Frontend/UI lane

Restore the missing `web/` frontend as a tracked first-class project. The frontend must own:

- the screenshot-style home page
- docs
- service catalog pages
- MCP/server-card help pages

Required behavior:

- default API origin is `https://api.aurelianflo.com`
- any `x402.aurelianflo.com` UI request redirects to the apex
- docs, OpenAPI links, MCP links, and server-card links all point to `api.aurelianflo.com`

Primary code control points:

- `web/next.config.ts`
- `web/src/app/page.tsx`
- `web/src/app/docs/page.tsx`
- `web/src/app/server-card/page.tsx`
- `web/src/middleware.ts` or `web/src/proxy.ts`

## Verification

Before deployment:

- backend build succeeds
- frontend build succeeds

After deployment:

- `https://aurelianflo.com` returns the UI
- `https://x402.aurelianflo.com` returns a redirect to `https://aurelianflo.com`
- `https://api.aurelianflo.com/` returns JSON
- `https://api.aurelianflo.com/api?format=json` returns discovery JSON
- `https://aurelianflo.com/.well-known/mcp/server-card.json` is either intentionally absent or explicitly proxied without loops
- `https://api.aurelianflo.com/.well-known/mcp/server-card.json` returns JSON

## Execution Order

1. Restore and track the frontend from preserved state.
2. Implement backend host separation and canonical API base URL updates.
3. Implement frontend host separation and UI link updates.
4. Build both projects locally.
5. Deploy backend to `api.aurelianflo.com`.
6. Deploy frontend to `aurelianflo.com`.
7. Point `x402.aurelianflo.com` to the frontend project and redirect it to the apex.
