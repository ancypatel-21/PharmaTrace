# Demo runbook

Run the whole PharmaTrace system on your own computer from a fresh clone: local blockchain,
contract, demo participants, demo batches and the web app. Added in V6.

## 1. Prerequisites

- **Node.js 18-22 (LTS)** and npm. Newer Node versions work, but Hardhat prints a support warning.
- **Git**.
- **MetaMask** in Chrome, Brave, Edge or Firefox (only needed to act as a participant; the public
  verify page works without it).

## 2. One-time setup

```bash
git clone https://github.com/ancypatel-21/PharmaTrace.git
cd PharmaTrace
npm run setup          # installs the root (contracts, simulator) and web/ dependencies
```

No `.env` is needed for the local demo.

## 3. Start the demo (one command)

```bash
npm run demo
```

This:

1. starts a local Hardhat node (output in `demo-node.log`),
2. deploys `ProvenanceTracker` (`scripts/deploy.js`),
3. registers the six participants (`scripts/seed-roles.js`),
4. exports the address + ABI to the web app and simulator (`scripts/export-abi.js`),
5. seeds two demo batches (`scripts/e2e-journey.js`),
6. starts the web app at **http://localhost:5173**.

Press **Ctrl+C** once to stop everything. Each start is a fresh chain: earlier batches are gone.

Options:

| Command | What it does |
| --- | --- |
| `npm run demo -- --lan` | Also reachable from a phone on the same Wi-Fi (needed to scan batch QR codes). Open the app from the **Network** address Vite prints. |
| `npm run demo -- --no-seed` | Roles only, no demo batches (start from an empty chain). |
| `npm run demo -- --no-web` | Chain and data only; start the web app yourself with `npm run web`. |

### What is seeded

| Account (Hardhat #) | Role | Name |
| --- | --- | --- |
| #0 | Admin (deployer) | |
| #1 | Manufacturer | Acme Pharma |
| #2 | Distributor | MedDistrib |
| #3 | Carrier | ColdFreight |
| #4 | Pharmacy | CityCare Pharmacy |
| #5 | Regulator | Health Authority |
| #6 | Oracle | Sensor Oracle |

| Batch | Journey | Ends as |
| --- | --- | --- |
| #1 | Registered, approved, Manufacturer → Distributor, stored, normal temperature report, Distributor → Pharmacy, stored, dispensed | **Dispensed** |
| #2 | Registered, approved, Manufacturer → Carrier, temperature excursion (automatic quarantine), recalled by the Regulator | **Recalled** (red banner) |

Open http://localhost:5173/verify/1 and http://localhost:5173/verify/2 to see both.

## 4. MetaMask setup (to act as a participant)

1. **Add the network**: MetaMask → Networks → Add network manually:
   - Network name: `Hardhat local`
   - RPC URL: `http://127.0.0.1:8545`
   - Chain ID: `31337`
   - Currency symbol: `ETH`

   (With `--lan` on a phone, use the laptop's address instead of `127.0.0.1`.)
2. **Import the test accounts**: open `demo-node.log`, copy the private keys of accounts #0-#6
   and use MetaMask → Add account → Import account for each. These are Hardhat's public test
   keys: they hold no real funds. Never send real funds to them or use them on a public network.
3. **Connect**: open the app, click **Connect wallet** and select all seven accounts. The account
   picker in the header then switches between them, showing each one's role.
4. **After every restart of the demo**: MetaMask → Settings → Advanced → **Clear activity tab
   data**, otherwise it reuses old nonces and transactions fail with a nonce error.

## 5. Demo walkthrough (about 5 minutes)

| # | Account | Page | Action |
| --- | --- | --- | --- |
| 1 | none | `/verify/1`, `/verify/2` | Consumer view: approved and dispensed vs. recalled with the excursion and reason. |
| 2 | #0 Admin | `/admin` | Participants and their roles; register or revoke one. |
| 3 | #1 Manufacturer | `/manufacturer` | Register a batch. Note its ID and QR code. |
| 4 | #5 Regulator | `/regulator` | Approve the new batch (required before its first shipment). |
| 5 | #1 Manufacturer | `/custody` | Send the batch to MedDistrib. |
| 6 | #2 Distributor | `/custody` | Accept it, then mark it stored. |
| 7 | terminal | | `npm run sim -- --batch <id> --scenario normal`: in-range report, status unchanged. |
| 8 | terminal | | `npm run sim -- --batch <id> --scenario excursion`: the batch is quarantined automatically. |
| 9 | #5 Regulator | `/regulator` | Release the quarantine, or recall the batch with a reason. |
| 10 | phone | QR code | With `--lan`, scan the batch QR from the Manufacturer page: the verify page opens. |

## 6. Individual commands

The same steps as `npm run demo`, one at a time (each in the repo root):

| Command | What it does |
| --- | --- |
| `npm run node` | Start the local Hardhat node (leave it running in its own terminal). |
| `npm run deploy:local` | Deploy `ProvenanceTracker` and export the address + ABI. |
| `npm run seed` | Register the six participants and seed the two demo batches. |
| `npm run web` | Start the web app (http://localhost:5173). |
| `npm run sim -- --batch <id> --scenario normal\|excursion\|noisy` | Report a temperature window as the Oracle. |

## 7. Tests

| Command | What it runs |
| --- | --- |
| `npm test` | All contract tests, including the end-to-end journeys. |
| `npm run test:e2e` | End-to-end journeys only (`test/e2e.test.js`). |
| `npm run test:sim` | Simulator unit and local-node integration tests. |
| `npm run test:web` | Web app unit tests. |
| `npm run test:all` | All of the above. |

## 8. Troubleshooting

| Problem | Fix |
| --- | --- |
| `Port 8545 is already in use` | Another node is running (maybe an earlier demo). Stop it, then start again. |
| `Port 5173 is already in use` | Another web dev server is running. Stop it, or use `--no-web`. |
| MetaMask: nonce too high / transaction fails after a restart | Settings → Advanced → Clear activity tab data. |
| App says "Switch to Hardhat local" | MetaMask is on another network: click the button, or select Hardhat local. |
| Page shows "No role" | The connected account is not #1-#6, or the demo was restarted and roles were re-seeded: reconnect. |
| Phone cannot open the QR link | Start with `npm run demo -- --lan`, open the app from the **Network** address and keep the phone on the same Wi-Fi. |
| `git status` shows `deployments/localhost.json` changed | Each deploy rewrites its timestamp. Don't commit it: `git checkout -- deployments/localhost.json`. |
