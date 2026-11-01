# Access Matrix

Per-stakeholder read/write access, the transactions each stakeholder sends, and the events each
stakeholder causes. Required by the course spec. Reflects the interfaces merged in A2/N1/S1/B1/V1;
function bodies land through Phase 1 (see the work plan).

Roles are granted by the Admin (deployer, `DEFAULT_ADMIN_ROLE`) via `registerParticipant`. An
address can hold more than one role at once.

| Stakeholder | Read access | Write access (transactions sent) | Events caused |
| --- | --- | --- | --- |
| **Manufacturer** | `getBatch`, `getBatchSummary`, `getCustodyHistory`, `getLatestTemperature` | `registerBatch` (create a new batch); `initiateTransfer` (first handoff, to a Distributor or Carrier) | `BatchRegistered`; `CustodyTransferInitiated`; `StatusChanged` |
| **Distributor** | `getBatch`, `getBatchSummary`, `getCustodyHistory`, `getLatestTemperature` | `acceptTransfer` (from Manufacturer or Carrier); `initiateTransfer` (to a Carrier or Pharmacy); `markStored`, if current custodian; `cancelTransfer`, if kept (team vote pending) | `CustodyTransferAccepted`; `CustodyTransferInitiated`; `StatusChanged`; `CustodyTransferCancelled`, if kept |
| **Carrier** | `getBatch`, `getBatchSummary`, `getCustodyHistory`, `getLatestTemperature` | `acceptTransfer` (from Manufacturer or Distributor); `initiateTransfer` (to a Distributor or Pharmacy); `markStored`, if current custodian; `cancelTransfer`, if kept | `CustodyTransferAccepted`; `CustodyTransferInitiated`; `StatusChanged`; `CustodyTransferCancelled`, if kept |
| **Pharmacy** | `getBatch`, `getBatchSummary`, `getCustodyHistory`, `getLatestTemperature` | `acceptTransfer` (final hop, from a Distributor or Carrier); `markStored`, if current custodian; `markDispensed` (terminal) | `CustodyTransferAccepted`; `StatusChanged` |
| **Regulator** | All of the above, plus visibility into every batch regardless of custody | `quarantineBatch`; `releaseQuarantine`; `recallBatch`; `approveBatch` | `BatchQuarantined`; `QuarantineReleased`; `BatchRecalled`; `BatchApproved`; `StatusChanged` |
| **Oracle** | `getBatch` (to check status before reporting) | `reportTemperature` (summary submitted by the off-chain simulator) | `TemperatureReported`; `TemperatureExcursion`, `BatchQuarantined` and `StatusChanged` if the reading is out of range |
| **Consumer / public** | `getBatchSummary`, `getBatch`, `getCustodyHistory`, `getLatestTemperature` (read-only, no wallet needed) | None | None |

## Admin (not one of the seven stakeholder roles, but required to bootstrap them)

| Stakeholder | Read access | Write access | Events caused |
| --- | --- | --- | --- |
| **Admin** (`DEFAULT_ADMIN_ROLE`, deployer) | All reads | `registerParticipant`; `revokeParticipant` | `ParticipantRegistered` |

## Notes

- `markStored` and `cancelTransfer` are not role-restricted beyond "current custodian" in the
  interface as declared, so any of Distributor/Carrier/Pharmacy can call them while holding the
  batch; `markDispensed` is Pharmacy-only.
- Three items are still open for a team vote (tracked in the S1 PR, N1 interface comments):
  whether a batch must be `approveBatch`-approved before its first `initiateTransfer`, whether
  `cancelTransfer` stays in scope, and whether a Manufacturer may also call `recallBatch`.
- Full transition table: [`state-machine.md`](state-machine.md). Module/file ownership:
  [`architecture.md`](architecture.md). Public verify page data mapping: [`ui-data.md`](ui-data.md).
