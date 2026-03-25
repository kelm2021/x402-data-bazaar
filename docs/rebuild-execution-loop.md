# Rebuild Execution Loop

The rebuild now has one practical question:

- is the core wedge earning the right to stay the focus

## Command

Run:

```powershell
npm run rebuild:status
```

This command checks:

- whether the core wedge is live
- whether unpaid and paid verification exist
- whether Bazaar discovery has indexed it
- how it is doing against the 14-day, 21-day, and 30-day gates from the rebuild blueprint

## How To Interpret It

- If the core wedge is live and paid but not indexed:
  - do not build wedge #2 yet
  - keep rechecking discovery
  - push the MCP distribution pack
- If discovery is fine but external probes are weak:
  - the next job is distribution
- If probes exist but external paid use is weak:
  - improve offer packaging, metadata, and buyer clarity
- If paid use exists but repeat use is weak:
  - do not expand yet
  - prove the wedge can become passive income

## Legacy Rules

- `legacy-keep` sellers may stay live, but scope is frozen
- `legacy-kill` sellers are frozen and should be retired if they become noisy
- no new generic utility routes should be added while the core wedge is still proving itself

## Present Reality

At this stage, the only justified build work is:

- improve the core wedge if the market data points there
- or add the next adjacent wedge only after the core gates pass

For the current distribution pack, use:

```powershell
npm run restricted-party-screen:distribution-pack
```
