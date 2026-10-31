# Public verify page: data it reads

What the public verify page (`/verify/:id`, V3) shows and where each value comes from. Added in
V1 (10/30). No wallet is needed: the page uses a read-only `JsonRpcProvider`, so every source
below is a `view` function or an event log.

## Contract reads

| Read | Owner | Used for |
| --- | --- | --- |
| `getBatchSummary(id)` | Vigneshkumar (V1) | Main call: exists flag, batch, latest temperature, report count, approver |
| `getCustodyHistory(id)` | Nandana (N1/N3) | Custody timeline (`<CustodyTimeline>`, N6) |
| `getBatch(id)` | Ancy (A5) | Fallback if `getBatchSummary` is not deployed yet |
| `getLatestTemperature(id)` | Vigneshkumar (V1), data stored by Barath (B3) | Fallback for the temperature card |

`getBatchSummary` returns `exists = false` for unknown IDs instead of reverting, so one call is
enough to decide between the "Not found" message and the full page.

## Page sections

| Section | Value | Source |
| --- | --- | --- |
| Header | Product name, lot number, expiry date | `batch.productName`, `batch.lotNumber`, `batch.expiryDate` |
| Header | Manufacturer | `batch.manufacturer`, display name from `ParticipantRegistered` |
| Approval badge | Approved / not approved, approver, certificate hash | `batch.approved`, `approvedBy`, `batch.certificateHash` |
| Status | Current status badge | `batch.status` |
| Status | Current custodian | `batch.currentCustodian`, display name from `ParticipantRegistered` |
| Status | Pending handoff (if any) | `batch.pendingCustodian` (non-zero while InTransit) |
| Warning banner | Red banner for Quarantined or Recalled, with reason | `batch.status`, reason from `BatchQuarantined` / `BatchRecalled` |
| Temperature | Latest min/max, reading count, window | `latestTemperature` (hidden when `reportedAt == 0`) |
| Temperature | Number of reports | `temperatureReportCount` |
| Temperature | Excursions | `TemperatureExcursion` events |
| Timeline | Custody handoffs in order | `getCustodyHistory(id)` + custody events |
| Timeline | Status changes | `StatusChanged` events |

## Events the UI queries

All events are declared in `IProvenanceTracker.sol` (A2). The page filters each one by the
indexed `batchId` (`contract.queryFilter(contract.filters.X(id))`) and merges the results by
block number and log index to build the timeline.

| Event | Shown as |
| --- | --- |
| `BatchRegistered(batchId, manufacturer, lotNumber)` | First timeline entry: "Registered by ..." |
| `BatchApproved(batchId, approvedBy, certificateHash)` | "Approved by ..." |
| `CustodyTransferInitiated(batchId, from, to)` | "Shipped from ... to ..." |
| `CustodyTransferAccepted(batchId, from, to)` | "Received by ..." |
| `StatusChanged(batchId, from, to, actor)` | Status change entries (Stored, Dispensed, ...) |
| `TemperatureReported(batchId, minTenthsC, maxTenthsC, readingCount)` | Temperature history list |
| `TemperatureExcursion(batchId, minTenthsC, maxTenthsC)` | Highlighted excursion entries |
| `BatchQuarantined(batchId, reason, previousStatus)` | "Quarantined: reason" |
| `QuarantineReleased(batchId, restoredStatus)` | "Released from quarantine" |
| `BatchRecalled(batchId, reason)` | "Recalled: reason" |
| `ParticipantRegistered(account, role, name)` | Not on the timeline; maps addresses to display names |

## Display rules

- Temperatures are stored in tenths of a degree: show `value / 10` with one decimal and "°C".
  The safe range is 2.0-8.0 °C (20-80).
- Timestamps (`expiryDate`, `createdAt`, `windowStart`, `windowEnd`, `reportedAt`) are Unix
  seconds; multiply by 1000 for `Date`.
- Addresses with a `ParticipantRegistered` name show the name (e.g. "CityCare Pharmacy"), with the
  shortened address on hover.
- Unknown ID (`exists == false`) shows a "Not found" message, not an error.
- Quarantined or Recalled show a red banner at the top of the page.
- Expired batches (`expiryDate` in the past) get an "Expired" warning even if the status is fine.

## Open questions for the team

1. **Approver address.** S4 records `approvedBy`, but `struct Batch` has no `approvedBy` field.
   `getBatchSummary` returns it separately, so S4 needs to store it (for example in a
   `mapping(uint256 => address)`). `PharmaTypes.sol` does not need to change.
2. **Who implements these views.** `getLatestTemperature` reads storage owned by OracleModule (B3).
   Proposal: Barath implements it in `OracleModule.sol`, and `getBatchSummary` is assembled in
   `ProvenanceTracker.sol` once all modules are in, using internal getters from each module.
