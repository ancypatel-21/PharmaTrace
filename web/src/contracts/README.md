# web/src/contracts

Contract config the web app loads at build time (`src/lib/config.js`).

## Written by `scripts/export-abi.js` (A7)

One file per network, named after the Hardhat network, e.g. `localhost.json` and `amoy.json`:

```json
{
  "network": "localhost",
  "chainId": 31337,
  "address": "0x...",
  "abi": [ ... ]
}
```

A split export also works: `<network>.json` with `address` and `chainId`, plus
`ProvenanceTracker.json` holding `abi`. The app picks the file named by `VITE_NETWORK`
(default `localhost`, see `web/.env.example`). Public addresses only: never write keys here.

## Mock (`mock/ProvenanceTracker.json`)

Until A7 runs, the app uses `mock/ProvenanceTracker.json`: the ABI compiled from
`contracts/interfaces/IProvenanceTracker.sol`, with no address. In mock mode the app shows a
banner, makes no contract calls, and maps the default Hardhat accounts #0-#6 to Admin,
Manufacturer, Distributor, Carrier, Pharmacy, Regulator and Oracle so the role pages can be
built before deployment.

Regenerate the mock after an interface change (from the repo root):

```bash
npx hardhat compile
node -e 'const a=require("./artifacts/contracts/interfaces/IProvenanceTracker.sol/IProvenanceTracker.json");const f="web/src/contracts/mock/ProvenanceTracker.json";const m=require("./"+f);m.abi=a.abi;require("fs").writeFileSync(f,JSON.stringify(m,null,2)+"\n")'
```
