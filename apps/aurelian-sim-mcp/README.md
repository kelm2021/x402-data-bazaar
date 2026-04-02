# aurelian-sim-mcp

MCP server for Aurelian simulation tools.

## Env
- `EVM_PRIVATE_KEY`: 0x-prefixed private key with Base USDC for x402 payments.
- `PORT`: optional (default `3000`).
- `SIM_API_BASE_URL`: optional override (default `https://x402.aurelianflo.com`).
- `SIM_INTERNAL_BYPASS_TOKEN`: optional shared secret sent as `x-sim-internal-bypass-token` for trusted internal calls.

## Run
```bash
npm install
npm run build
npm start
```

Server endpoints:
- `POST /mcp`
- `GET /health`
