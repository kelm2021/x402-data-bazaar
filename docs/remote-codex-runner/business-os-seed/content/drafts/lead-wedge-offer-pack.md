# Lead Wedge Offer Pack

## Lead Wedge

`restricted-party-screen` is the lead offer. `vendor-entity-brief` is the bundle and upsell.

## Who It Is For

- Procurement and vendor onboarding teams that need a fast counterparty check before they approve a supplier, partner, or payout path.
- Compliance, risk, and operations teams that want a lightweight screen before a human review.
- Agent workflows that need an immediate yes/no signal before spending more time on diligence.

## Problem It Solves

- “Can we trust this counterparty enough to keep moving?”
- “Do we need to stop here, or can we safely continue?”
- “What is the minimum useful diligence we can run without dragging a human into every lookup?”

The value is speed and decision support, not encyclopedic research.

## When To Use Screening Only

Use `restricted-party-screen` alone when you need a quick first-pass answer:

- one entity name
- one buyer decision
- one immediate gate
- low-friction automation

This is the right choice when the user wants a small, cheap, fast check before deciding whether to go deeper.

## When To Use The Bundle

Use `restricted-party-screen` plus `vendor-entity-brief` when the workflow needs both a decision and a short written context pack:

- the counterparty matters enough that someone will read a brief
- the team needs a short summary after the screen
- the buyer is doing onboarding, procurement, or vendor approval
- the result will be shared with a human reviewer or another agent

The bundle should feel like: screen first, context second.

## Payments MCP Prompts

1. `Run a quick restricted-party screen on this counterparty and return only the decision signal.`
2. `Screen this vendor, then generate a short vendor entity brief if the screen is clean enough to continue.`
3. `Check this counterparty for risk, and if there is a plausible match, explain the hit in plain language.`

## Direct Workflow Examples

1. A procurement agent is vetting a new supplier. It runs `restricted-party-screen` first. If the screen is clean, it proceeds. If the supplier looks material, it upgrades to the bundle and attaches the brief to the approval note.
2. A payout workflow is about to release funds to a new counterparty. The agent screens the entity before payment, then uses the bundle only if a human or downstream agent needs a compact explanation of the result.

## Pricing Language

Keep pricing believable and low-friction:

- `restricted-party-screen`: inexpensive enough to use as a default gate, not a budget decision
- `vendor-entity-brief` bundle: a modest step up because it saves review time and produces a usable handoff artifact

Suggested language:

- “Fast screening for routine counterparty checks.”
- “Add a short entity brief when you need to hand the result to a human or another agent.”
- “Pay for the check, not the ceremony.”

Avoid heroic pricing. This is a workflow utility, not a premium research product. If the buyer just needs the gate, keep the gate cheap.

## Conversion Notes

- Lead with the screen.
- Offer the brief only when it reduces review time.
- Do not overpromise proprietary intelligence.
- Sell speed, clarity, and handoff quality.
