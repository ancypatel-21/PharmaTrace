# Gas Report

Gas usage for every state-changing function on the deployed `ProvenanceTracker` contract, plus
cost estimates on Polygon Amoy (actual, from the live deployment transaction), Polygon PoS
mainnet, and Ethereum mainnet. Solidity optimizer: enabled, 200 runs (see `hardhat.config.js`).

## Contract deployment

| | Gas used | Source |
| --- | --- | --- |
| Local Hardhat network (258-test suite) | 2,939,535 | `hardhat-gas-reporter` |
| **Polygon Amoy (actual deployment)** | **2,943,735** | On-chain receipt, tx [`0xcdcd05...6538b`](https://amoy.polygonscan.com/tx/0xcdcd0541a6d7061f9b9b4932787a688d58a71fac15300e61b7f50266a266538b) |

Deployed and verified at
[`0x265D2838168F3E6B147E25a424411C7106e853A4`](https://amoy.polygonscan.com/address/0x265D2838168F3E6B147E25a424411C7106e853A4#code)
on Polygon Amoy (chain ID 80002).

**Actual Amoy deployment cost:** 2,943,735 gas x 169.04 gwei effective gas price = **0.4976 POL**.
Amoy POL is test currency with no real value; this number demonstrates the real transaction cost
measured on a live network, not a local simulation.

## Per-function gas (from the 258-test contract suite)

Gas varies with input (e.g. a string's length, how many prior roles an account holds, how far a
status moves through the transition table), so this table shows min / max / average across every
call made in the suite, not a single synthetic number.

| Function | Min | Max | Avg | Calls |
| --- | --- | --- | --- | --- |
| `registerParticipant` | 55,956 | 76,048 | 75,180 | 54 |
| `revokeParticipant` | 40,132 | 44,185 | 40,808 | 6 |
| `registerBatch` | 195,564 | 215,884 | 197,469 | 75 |
| `approveBatch` | 78,454 | 95,566 | 94,011 | 55 |
| `markStored` | - | - | 34,216 | 18 |
| `markDispensed` | - | - | 36,727 | 5 |
| `quarantineBatch` | 40,497 | 60,571 | 50,076 | 31 |
| `releaseQuarantine` | 38,615 | 38,655 | 38,631 | 18 |
| `recallBatch` | 38,052 | 68,390 | 56,940 | 33 |
| `initiateTransfer` | 44,404 | 69,011 | 47,919 | 35 |
| `acceptTransfer` | 99,145 | 111,539 | 109,244 | 27 |
| `cancelTransfer` | - | - | 38,984 | 1 |
| `reportTemperature` | 51,672 | 157,124 | 135,188 | 56 |

`reportTemperature`'s range is wide because an in-range reading only updates two mappings, while
an excursion also quarantines the batch in the same transaction (`_quarantine` -> `_changeStatus`
-> a `StatusChanged` + `BatchQuarantined` emit), roughly tripling the gas cost. A live end-to-end
run (`scripts/e2e-journey.js`) confirms this in practice: 122,964 gas for a normal reading vs.
156,414 gas for one that triggers an automatic quarantine.

`registerBatch` is the single most expensive write (~195-216k gas): it writes a full `Batch`
struct (eleven fields, two of them dynamic `string`s) to a fresh storage slot in one transaction.

## Cost comparison

Gas price and token price are live market data, not fixed assumptions, so the USD figures below
are a snapshot as of **2026-11-27/28** and will drift with market conditions. Sources: Polygon gas
tracker ([polygonscan.com/gastracker](https://polygonscan.com/gastracker)), Ethereum gas tracker
([datawallet.com/ethereum-gas-price](https://www.datawallet.com/ethereum-gas-price)), and token
prices from [CoinGecko](https://www.coingecko.com/en/coins/polygon) /
[CoinDesk](https://www.coindesk.com/price/ethereum).

| Market | Gas price | Token price |
| --- | --- | --- |
| Polygon Amoy (actual, this deployment) | 169.04 gwei | n/a (test POL) |
| Polygon PoS mainnet (snapshot) | 276.76 gwei | POL ~$0.0766 |
| Ethereum mainnet (snapshot) | 0.268 gwei | ETH ~$1,664.28 |

| Function | Avg gas | Cost on Polygon PoS mainnet | Cost on Ethereum mainnet |
| --- | --- | --- | --- |
| Deploy `ProvenanceTracker` | 2,943,735 | $0.0624 | $1.3130 |
| `registerParticipant` | 75,180 | $0.00159 | $0.0335 |
| `registerBatch` | 197,469 | $0.00419 | $0.0881 |
| `approveBatch` | 94,011 | $0.00199 | $0.0419 |
| `initiateTransfer` | 47,919 | $0.00102 | $0.0214 |
| `acceptTransfer` | 109,244 | $0.00232 | $0.0487 |
| `reportTemperature` (normal) | 122,964 | $0.00261 | $0.0548 |
| `reportTemperature` (excursion) | 156,414 | $0.00332 | $0.0698 |
| `recallBatch` | 56,940 | $0.00121 | $0.0254 |

Even at this snapshot, where Ethereum's gas price (0.268 gwei) is unusually low by its own
historical standards, every function is roughly **21x more expensive on Ethereum mainnet** than
on Polygon PoS mainnet — ETH's much higher token price (~$1,664 vs. POL's ~$0.077, a ~21,700x
difference) outweighs Ethereum's momentarily low gas price. Ethereum's gas price has historically
ranged from single digits to several hundred gwei during congestion; at a more typical 20 gwei and
the same ETH price, `registerBatch` alone would cost roughly **$6.57** — about **1,570x** the
Polygon PoS mainnet estimate above. This is why the team chose an EVM-compatible sidechain
(Polygon) over Ethereum L1 for a course project with many low-value, frequent transactions
(Section V of the project proposal).

## Storage vs. events: the design trade-off behind these numbers

Every module on this contract was written to keep on-chain storage minimal and push detail into
events, which cost roughly an order of magnitude less gas than storage (`SSTORE` on a fresh slot
is ~20,000 gas; a non-indexed event log word is a few hundred):

- **Custody history** (`CustodyModule.sol`) keeps only `{from, to, timestamp, statusAfter}` per
  accepted handoff on-chain; everything else (initiation time, cancellations) lives in
  `CustodyTransferInitiated` / `CustodyTransferCancelled` events, not storage.
- **Temperature readings** (`OracleModule.sol`) store only the latest `TempSummary` and a report
  count; every prior report's full detail is in `TemperatureReported` / `TemperatureExcursion`
  events, and the raw sensor readings never go on-chain at all — only a `keccak256` hash
  (`readingsHash`) anchors them to the off-chain JSON file the simulator writes.
- **Participant names** are the one piece of "nice to have" data kept in storage
  (`AccessRoles.sol`'s `_participantNames` mapping) rather than an event, specifically so the UI
  can show a name without re-scanning every `ParticipantRegistered` event on every page load.

This is the same trade-off IPFS-based designs make at a different layer (certificate files
off-chain, only a hash on-chain) — PharmaTrace applies it to sensor data and history instead of
waiting on the IPFS stretch goal to need it.
