# AGENTS.md

## Purpose

This repo implements canonical discovery logic for the agentcash ecosystem.

## Hard Constraints

1. Keep canonical core and compatibility modules physically separate.
2. Avoid legacy conditionals in `src/core/*`.
3. Preserve stable warning codes.
4. Keep `discover` token-light and deterministic.
5. Keep compatibility removable via a single top-level mode.

## Module Boundaries

- `src/core/*`: canonical OpenAPI-first discovery.
- `src/compat/legacy-x402scan/*`: `/.well-known/x402` + DNS `_x402` compatibility.

## Result Contract

Resource identity is always `origin + method + path`.
