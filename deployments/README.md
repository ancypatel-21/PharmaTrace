# deployments

Output of `scripts/deploy.js`, `scripts/seed-roles.js` and `scripts/export-abi.js`. Public
addresses and transaction metadata only — never a private key or seed phrase.

## `<network>.json` (written by `scripts/deploy.js`)

One file per network, e.g. `localhost.json` or `amoy.json`:

```json
{
  "network": "amoy",
  "chainId": 80002,
  "address": "0x...",
  "deployer": "0x...",
  "blockNumber": 12345,
  "txHash": "0x...",
  "deployedAt": "2026-11-14T12:00:00.000Z"
}
```

## `demo-accounts.json` (read by `scripts/seed-roles.js`)

Public addresses to grant the six participant roles to, keyed by network and role name:

```json
{
  "amoy": {
    "MANUFACTURER": { "address": "0x...", "name": "Acme Pharma" },
    "DISTRIBUTOR": { "address": "0x...", "name": "MedDistrib" },
    "CARRIER": { "address": "0x...", "name": "ColdFreight" },
    "PHARMACY": { "address": "0x...", "name": "CityCare Pharmacy" },
    "REGULATOR": { "address": "0x...", "name": "Health Authority" },
    "ORACLE": { "address": "0x...", "name": "Sensor Oracle" }
  }
}
```

Fill in each teammate's public test wallet address before running `seed-roles.js` against
`amoy`. Leave an entry's `address` empty to skip that role; the script logs a message and
continues rather than failing the whole run.

`localhost` and `hardhat` do not need an entry here: `seed-roles.js` seeds the next six default
Hardhat signers automatically, since that mnemonic is the same for every clone of this repo and
holds no real funds.

## What is not committed

`.gitignore` excludes nothing under `deployments/` by name, but no file here should ever contain
a private key — only `.env` (already gitignored) holds those.
