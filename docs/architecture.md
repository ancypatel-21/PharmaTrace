# Architecture

One `ProvenanceTracker` contract on Polygon Amoy, built from small per-owner module files so
five people never edit the same Solidity file. Established in A2 (10/29); do not restructure
without a WhatsApp heads-up and a team OK.

## Module layout

| File | Owner | Added in |
| --- | --- | --- |
| `contracts/PharmaTypes.sol` | Ancy | A2 |
| `contracts/interfaces/IProvenanceTracker.sol` | shared, sectioned per owner | A2, N1, S1, B1, V1 |
| `contracts/ProvenanceTracker.sol` | shared skeleton, assembled via inheritance | A2, A5, S2, N2, B3 |
| `contracts/modules/AccessRoles.sol` | Ancy | A4 |
| `contracts/modules/BatchRegistry.sol` | Ancy | A5 |
| `contracts/modules/StatusModule.sol` | Shreyanshi | S2, S3, S4 |
| `contracts/modules/CustodyModule.sol` | Nandana | N2, N3 |
| `contracts/modules/OracleModule.sol` | Barath | B3 |

`ProvenanceTracker.sol` inherits from each module as that module's commit lands, so the final
deployed contract is the sum of all modules. No single file is shared editing surface for more
than one owner.

## Shared types

`PharmaTypes.sol` defines, at file level (not inside a contract, per modern Solidity):

- `enum Status` — Created, InTransit, Received, Stored, Dispensed, Quarantined, Recalled.
- `struct Batch` — id, productName, lotNumber, expiryDate, manufacturer, currentCustodian,
  pendingCustodian, status, approved, certificateHash, createdAt.
- `struct TempSummary` — minTenthsC, maxTenthsC, readingCount, windowStart, windowEnd,
  readingsHash, reportedAt.

## Shared internal hooks

Declared as virtual internal functions on the abstract `ProvenanceTracker` skeleton, so modules
can call across each other through the final contract's inheritance chain without importing one
another directly:

- `_changeStatus(batchId, newStatus)` — implemented by Shreyanshi's `StatusModule` (S2); called
  internally by `CustodyModule` (N2) and `OracleModule` (B3).
- `_quarantine(batchId, reason)` — implemented by Shreyanshi's `StatusModule` (S3); called
  internally by `OracleModule` (B3) on a temperature excursion.

## Interface sections

`IProvenanceTracker.sol` declares every event up front (agreed in A2) plus one clearly marked
section per owner. Each owner adds their own function signatures and NatSpec to their section in
their own Fri 10/30 commit (N1, S1, B1, V1); Ancy's section (registration, access control, batch
registration, reads) is added as A4/A5 land.

## Related docs

- `docs/state-machine.md` (S1) — status transition table.
- `docs/access-matrix.md` (A3) — per-stakeholder read/write access, transactions, events.
- `docs/ui-data.md` (V1) — what the public verify page reads.
- `docs/gas-report.md` (A10) — gas cost table.
- `docs/demo-runbook.md` (V6) — one-command local demo.
