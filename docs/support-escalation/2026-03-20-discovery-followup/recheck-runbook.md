# Re-check Runbook (1-2 Hour Cycles)

## Goal
Re-check CDP discovery and 402index after 1-2 hourly cycles and escalate only if unchanged.

## One-Command Automation
Dry run (checks only, no submission):

```powershell
npm run escalation:auto
```

Fast local validation (1 minute + 2 minute cycles):

```powershell
npm run escalation:auto:test
```

Live auto-submit mode (if unchanged after cycle 2):

```powershell
npm run escalation:auto:live
```

Required env vars for live submit (email mode):
- `RESEND_API_KEY`
- `SUPPORT_EMAIL_FROM` (must be a verified sender in Resend)
- `CDP_SUPPORT_EMAIL_TO`
- `INDEX402_SUPPORT_EMAIL_TO` (optional; defaults to `hello@402index.io`)

Optional fallback mode (webhook):
- Run `node scripts/discovery_escalation_automation.cjs --live-submit --submit-mode webhook`
- `CDP_TICKET_WEBHOOK_URL`
- `INDEX402_TICKET_WEBHOOK_URL`
- `CDP_TICKET_WEBHOOK_BEARER_TOKEN` (optional)
- `INDEX402_TICKET_WEBHOOK_BEARER_TOKEN` (optional)

## Cycle 1 (T+1h)
Run from repo root:

```powershell
node scripts/automation_http.cjs discovery x402-data-bazaar.vercel.app > docs/support-escalation/2026-03-20-discovery-followup/recheck-cycle1-discovery.json
node scripts/automation_http.cjs 402index-check "https://x402-data-bazaar.vercel.app" > docs/support-escalation/2026-03-20-discovery-followup/recheck-cycle1-402index.json
```

## Cycle 2 (T+2h)

```powershell
node scripts/automation_http.cjs discovery x402-data-bazaar.vercel.app > docs/support-escalation/2026-03-20-discovery-followup/recheck-cycle2-discovery.json
node scripts/automation_http.cjs 402index-check "https://x402-data-bazaar.vercel.app" > docs/support-escalation/2026-03-20-discovery-followup/recheck-cycle2-402index.json
```

## Unchanged Trigger (Send Both Tickets)
Escalate if all are still true after cycle 2:
1. Discovery host match count has not improved.
2. 402index host search still only returns the same 3 stale routes.
3. Those routes still have `price_usd = null` and `category = uncategorized`.

## Ready-To-Send Drafts
- `docs/support-escalation/2026-03-20-discovery-followup/cdp-bazaar-ticket.md`
- `docs/support-escalation/2026-03-20-discovery-followup/402index-manual-import-request.md`
