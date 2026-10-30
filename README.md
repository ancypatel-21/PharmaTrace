# PharmaTrace

Blockchain cold-chain provenance tracking for medicines. CSE 540, Group 15, Fall B 2026.

One Solidity contract, `ProvenanceTracker`, on the Polygon Amoy testnet (Hardhat + OpenZeppelin),
with role-based access for Manufacturer, Distributor, Carrier, Pharmacy, Regulator and Oracle. It
registers batches with unique IDs, runs two-step custody transfers (send, then accept), enforces a
status state machine (Created, InTransit, Received, Stored, Dispensed, plus Quarantined and
Recalled), and emits an event for every change. Off-chain, a Node.js IoT simulator reports
temperature summaries through the Oracle role; any reading outside 2-8 °C quarantines the batch
automatically. A React web app serves each role plus a public verify page for consumers.

## Team

| Member | Feature area |
| --- | --- |
| Ancy Pankajkumar Patel | Roles, registration, access control, deployment configuration |
| Shreyanshi Dipinkumar Bhatt | Status transitions, quarantine/recall logic, regulator workflow |
| Nandana Vikraman | Custody transfers, provenance/history tracking, related UI |
| Barath Suresh | Temperature simulator, oracle integration, excursion detection |
| Vigneshkumar Venugopal | Public verification/history UI, system integration, end-to-end testing |

## Roles, registration, access control and deployment (Ancy)

_This section will describe the role-based access control, batch registration, and deployment
setup as that work is completed._

## Status transitions, quarantine/recall and regulator workflow (Shreyanshi)

_This section will describe the status state machine, quarantine/recall logic, and regulator
approval workflow as that work is completed._

## Custody transfers and provenance history (Nandana)

_This section will describe the two-step custody transfer process and provenance history
tracking as that work is completed._

## Temperature simulator and oracle integration (Barath)

_This section will describe the temperature sensor simulator and oracle integration as that
work is completed._

## Public verification UI and system integration (Vigneshkumar)

_This section will describe the public verification page and system integration as that work
is completed._

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

# start a local Hardhat node (separate terminal)
npx hardhat node

# lint / format Solidity
npm run lint
npm run format
```

Deployment to Polygon Amoy, the React web app, and the Node.js simulator are documented in their
own sections above as those commits land.
