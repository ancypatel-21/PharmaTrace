# PharmaTrace

Blockchain cold-chain provenance tracking for medicines. CSE 540, Group 15, Fall B 2026.

**Status: Smart Contract Design Draft (v0.1-draft).** The interfaces below are agreed and merged;
the implementation modules (AccessRoles, BatchRegistry, StatusModule, CustodyModule, OracleModule)
land through Phase 1 of the work plan. Deploy/run instructions are intentionally incomplete at
this stage.

## Problem

Insulin, vaccines, and other temperature-sensitive medicines pass through manufacturers,
distributors, carriers, and pharmacies that each keep separate records. No party can prove a
batch is authentic or that it stayed within the required 2-8 °C range, so counterfeit or
heat-damaged products can reach patients unnoticed and recalls are slow. PharmaTrace records each
batch's registration, custody transfers, storage conditions, and certificate hashes on a
tamper-evident ledger, so every participant and the public can verify a batch's history.

## System overview

One Solidity contract, `ProvenanceTracker`, on the Polygon Amoy testnet (Hardhat + OpenZeppelin),
with role-based access for Manufacturer, Distributor, Carrier, Pharmacy, Regulator and Oracle. It
registers batches with unique IDs, runs two-step custody transfers (send, then accept), enforces a
status state machine (Created, InTransit, Received, Stored, Dispensed, plus Quarantined and
Recalled), and emits an event for every change. Off-chain, a Node.js IoT simulator reports
temperature summaries through the Oracle role; any reading outside 2-8 °C quarantines the batch
automatically. A React web app serves each role plus a public verify page for consumers.

The contract is composed from small per-owner module files rather than one shared file, so five
people never edit the same code at once. See [`docs/architecture.md`](docs/architecture.md) for
the module layout and [`docs/access-matrix.md`](docs/access-matrix.md) for the per-stakeholder
access table required by the course spec.

## Team

| Member | Feature area |
| --- | --- |
| Ancy Pankajkumar Patel | Roles, registration, access control, deployment configuration |
| Shreyanshi Dipinkumar Bhatt | Status transitions, quarantine/recall logic, regulator workflow |
| Nandana Vikraman | Custody transfers, provenance/history tracking, related UI |
| Barath Suresh | Temperature simulator, oracle integration, excursion detection |
| Vigneshkumar Venugopal | Public verification/history UI, system integration, end-to-end testing |

## Status state machine

| From | To | Trigger / actor |
| --- | --- | --- |
| `Created` | `InTransit` | Current custodian initiates a transfer (only after Regulator approval) |
| `InTransit` | `Received` | Pending custodian accepts the transfer |
| `Received` | `Stored` | Current custodian marks the batch stored |
| `Received` / `Stored` | `InTransit` | Current custodian initiates the next transfer |
| `Stored` | `Dispensed` | Pharmacy custodian dispenses (terminal) |
| any non-terminal | `Quarantined` | Regulator, or automatically on a temperature excursion |
| `Quarantined` | previous status | Regulator releases the quarantine |
| `Quarantined` | `Recalled` | Regulator, or the batch's own Manufacturer, recalls the batch (terminal) |

Full detail, including quarantine and terminal-state behavior: [`docs/state-machine.md`](docs/state-machine.md).

## Contract interface by feature

All signatures below are declared in [`contracts/interfaces/IProvenanceTracker.sol`](contracts/interfaces/IProvenanceTracker.sol),
with full NatSpec on each function. Shared types live in [`contracts/PharmaTypes.sol`](contracts/PharmaTypes.sol):
the `Status` enum, the `Batch` struct, and the `TempSummary` struct (temperatures as tenths of a
degree Celsius, e.g. 80 = 8.0 °C).

### Roles, registration, access control and deployment (Ancy)

- `registerParticipant(account, role, name)` / `revokeParticipant(account)` — admin-only role grants for the six participant roles (Manufacturer, Distributor, Carrier, Pharmacy, Regulator, Oracle).
- `registerBatch(productName, lotNumber, expiryDate, certificateHash)` — Manufacturer-only; returns a unique `batchId`.
- `getBatch(batchId)`, `batchExists(batchId)`, `totalBatches()` — reads.
- Implementation (`AccessRoles.sol`, `BatchRegistry.sol`), deploy scripts, and ABI export land in A4-A7.

### Status transitions, quarantine/recall and regulator workflow (Shreyanshi)

Implemented in [`contracts/modules/StatusModule.sol`](contracts/modules/StatusModule.sol) (S2-S4),
tested in S5, with the Regulator dashboard in S6.

**Public functions**

- `markStored(batchId)` — current custodian moves a `Received` batch to `Stored`.
- `markDispensed(batchId)` — Pharmacy custodian moves a `Stored` batch to `Dispensed` (terminal).
- `quarantineBatch(batchId, reason)` — Regulator-only, from any non-terminal status; the status held before quarantine is recorded. Emits `BatchQuarantined`.
- `releaseQuarantine(batchId)` — Regulator-only; restores exactly the recorded previous status. A pending transfer is kept, so a batch quarantined in transit can still be accepted or cancelled afterwards. Emits `QuarantineReleased`.
- `recallBatch(batchId, reason)` — Regulator, or the Manufacturer that registered the batch (while it still holds the Manufacturer role). Works from any non-terminal status by moving through `Quarantined` in the same transaction; clears any pending transfer. `Recalled` is terminal. Emits `BatchRecalled`.
- `approveBatch(batchId, certificateHash)` — Regulator-only, one-time; sets `approved`, records the approving Regulator and anchors the certificate hash. Emits `BatchApproved`.

**Shared internal hooks used by the other modules**

- `_changeStatus(batchId, newStatus)` — the single gate for every status change in the system. It checks the transition table above and emits `StatusChanged(batchId, from, to, actor)`. CustodyModule calls it on send, accept and cancel; OracleModule reaches it through `_quarantine`.
- `_quarantine(batchId, reason)` — called by OracleModule when a temperature report is outside 2-8 °C.
- `notFrozen(batchId)` modifier — rejects batches that are `Quarantined`, `Recalled` or `Dispensed`.

**Team decisions implemented**

- A batch must be approved by a Regulator before its first shipment: `Created` → `InTransit` reverts with `NotApproved` until `approveBatch` is called.
- A Manufacturer may recall its own batches; only a Regulator can quarantine or release.
- A pending transfer can be cancelled, returning the batch only to the status it held before the transfer.

Invalid actions revert with custom errors (`InvalidTransition`, `NotApproved`, `BatchFrozen`,
`NotQuarantined`, `EmptyReason`, `RecallNotAuthorized`, `AlreadyApproved`, `EmptyCertificateHash`).

**Regulator dashboard** (`/regulator` in the web app, [`web/src/pages/Regulator.jsx`](web/src/pages/Regulator.jsx)):
connect a wallet with the Regulator role (on a local node, Hardhat account #5 after
`scripts/seed-roles.js`). It lists every batch with a status filter, highlights quarantined
batches and temperature excursions, and offers approve (paste a certificate hash or hash a file in
the browser), quarantine and recall with a reason, and release. Only actions the contract would
accept are shown.

**Tests**

- [`test/status.test.js`](test/status.test.js) — every from/to pair of the transition table (84 pairs), the approval gate, recorded previous statuses, `notFrozen`, `markStored` and `markDispensed`.
- [`test/regulator.test.js`](test/regulator.test.js) — quarantine, release, recall and approval on the real contract, manufacturer recall, and role checks for every regulator action.
- [`web/src/lib/regulator.test.js`](web/src/lib/regulator.test.js) — dashboard logic: filters, sorting, available actions per status, input checks and error messages.

```bash
npx hardhat test test/status.test.js test/regulator.test.js
cd web && npx vitest run src/lib/regulator.test.js
```

### Custody transfers and provenance history (Nandana)

- `initiateTransfer(batchId, to)` — current custodian starts a two-step handoff to an allowed next-hop role; moves the batch to `InTransit`.
- `acceptTransfer(batchId)` — named recipient completes the handoff; moves the batch to `Received` and appends a `CustodyRecord`.
- `cancelTransfer(batchId)` — the sender withdraws a pending handoff; the batch returns to the status it held before the transfer.
- `getCustodyHistory(batchId)`, `getHistoryLength(batchId)` — full handoff history, oldest first.
- Allowed hops: Manufacturer → Distributor/Carrier; Distributor → Carrier/Pharmacy; Carrier → Distributor/Pharmacy.
- Implementation (`CustodyModule.sol`) lands in N2-N3.

### Temperature simulator and oracle integration (Barath)

- `reportTemperature(batchId, minTenthsC, maxTenthsC, readingCount, windowStart, windowEnd, readingsHash)` — Oracle-only; stores the latest `TempSummary` and auto-quarantines the batch if any reading falls outside 2-8 °C (tenths: 20-80).
- Raw sensor readings stay off-chain in `simulator/data/`; `readingsHash` anchors them on-chain.
- Implementation (`OracleModule.sol`, the Node.js simulator) lands in B2-B5.

### Public verification UI and system integration (Vigneshkumar)

- `getBatchSummary(batchId)` — one-call aggregate (exists flag, batch, latest temperature, report count, approver) for the public verify page; does not revert on unknown IDs.
- `getLatestTemperature(batchId)` — latest temperature summary and report count.
- What the verify page reads and how it's displayed: [`docs/ui-data.md`](docs/ui-data.md).
- Implementation (React app, verify page, e2e tests) lands in V2-V6.

## Dependencies

- [Node.js](https://nodejs.org/) 18+ and npm
- [Hardhat](https://hardhat.org/) 2.29 (`hardhat`) with the [Hardhat Toolbox](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-toolbox) 5.0 (bundles `ethers` v6, `hardhat-gas-reporter`, `hardhat-verify`, Chai matchers, and network helpers)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/5.x/) 5.6 (`@openzeppelin/contracts`) — `AccessControl` for role-based access
- [solhint](https://protofire.github.io/solhint/) 6.2 and [prettier](https://prettier.io/) 3.9 with `prettier-plugin-solidity`, for linting and formatting
- `dotenv`, to load `.env` into `hardhat.config.js`

All of the above are pinned in [`package.json`](package.json); `npm install` installs the exact
versions from [`package-lock.json`](package-lock.json). The web app (`web/`) and the simulator
(`simulator/`) have their own `package.json` files with their own dependencies.

## How to run

```bash
# install dependencies
npm install

# copy env template and fill in real values (never commit .env)
cp .env.example .env

# compile contracts
npm run compile

# run the contract test suite
npm test

# lint / format Solidity
npm run lint
npm run format
```

### Deploy locally and connect the web app / simulator to it

```bash
# start a persistent local node (separate terminal, leave running)
npx hardhat node

# deploy ProvenanceTracker to it, recording deployments/localhost.json
npx hardhat run scripts/deploy.js --network localhost

# grant the six participant roles to demo accounts (see deployments/README.md)
npx hardhat run scripts/seed-roles.js --network localhost

# export the address + ABI to web/src/contracts/ and simulator/config/
npx hardhat run scripts/export-abi.js --network localhost
```

Re-run `export-abi.js` for the current network any time a contract function or event signature
changes. The same three scripts work against `amoy` once `AMOY_RPC_URL` and
`DEPLOYER_PRIVATE_KEY` are set in `.env` (fund that wallet from the Amoy faucet first) and
`deployments/demo-accounts.json` has real participant addresses filled in.

Deployment to Polygon Amoy, the React web app, and the Node.js simulator are not implemented yet
at this draft stage; they land through Phase 1-2 of the work plan (A7-A9, V2-V6, B2-B6).
