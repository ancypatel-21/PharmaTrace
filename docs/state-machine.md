# PharmaTrace Status State Machine

This document describes the intended status transitions for pharmaceutical
batches tracked by the PharmaTrace smart contract.

## Batch Statuses

A batch can have one of the following statuses:

- `Created`
- `InTransit`
- `Received`
- `Stored`
- `Dispensed`
- `Quarantined`
- `Recalled`

## Status Transitions

| Current Status | Next Status | Trigger / Actor | Description |
|---|---|---|---|
| `Created` | `InTransit` | Current custodian | A custody transfer is initiated for a newly created batch. The batch must first be approved by a Regulator (`approveBatch`), otherwise this reverts with `NotApproved`. |
| `InTransit` | `Received` | Pending custodian | The recipient accepts the custody transfer. |
| `InTransit` | Status before the transfer | Current custodian (sender) | The sender cancels a pending transfer before it is accepted (`cancelTransfer`). The batch returns only to the status it held right before `InTransit` (`Created`, `Received` or `Stored`). |
| `Received` | `Stored` | Current custodian | The current custodian marks the received batch as stored. |
| `Received` | `InTransit` | Current custodian | The current custodian initiates the next custody transfer. |
| `Stored` | `InTransit` | Current custodian | A stored batch is sent to the next participant in the supply chain. |
| `Stored` | `Dispensed` | Pharmacy | The pharmacy dispenses the batch. `Dispensed` is a terminal status. |
| Any non-terminal status | `Quarantined` | Regulator or authorized Oracle path | The batch is quarantined manually by a Regulator or automatically after a temperature excursion. |
| `Quarantined` | Previous status | Regulator | The Regulator releases the quarantine and restores the status held immediately before quarantine. |
| `Quarantined` | `Recalled` | Regulator, or the batch's own Manufacturer | The batch is recalled. `Recalled` is a terminal status. |

## Quarantine Behavior

When a batch enters `Quarantined`, PharmaTrace preserves the status that the
batch had immediately before quarantine. If an authorized Regulator later
releases the quarantine, the batch returns to that previous status.

The Oracle path may automatically quarantine a batch when a reported
temperature falls outside the required 2-8 C cold-chain range.

While a batch is `Quarantined`, `Recalled` or `Dispensed` it is frozen: the
`notFrozen` modifier blocks custody transfers. A pending transfer is kept
during quarantine, so a batch quarantined while `InTransit` returns to
`InTransit` with the same pending recipient when released.

## Recall Behavior

`recallBatch` works from any non-terminal status. If the batch is not already
`Quarantined`, it is moved to `Quarantined` and then to `Recalled` in the same
transaction, so `Recalled` is still only reachable from `Quarantined` and both
moves appear as `StatusChanged` events. Any pending transfer is cleared.
Quarantine and recall both require a non-empty reason, which the verify page
shows.

A Regulator can recall any batch. The Manufacturer that registered a batch can
also recall that batch (most real drug recalls are started by the
manufacturer), as long as it still holds the Manufacturer role. A Manufacturer
cannot recall another manufacturer's batch, and only a Regulator can
quarantine a batch or release a quarantine.

## Terminal States

`Dispensed` and `Recalled` are terminal states. Once a batch reaches either
status, no further status transitions are allowed.

## Regulator Actions

An authorized Regulator is intended to perform the following actions:

- Quarantine a batch using `quarantineBatch`.
- Release a quarantined batch using `releaseQuarantine`.
- Recall a batch using `recallBatch`.
- Approve a batch and anchor its certificate hash using `approveBatch`.

The transition table above is enforced by `_changeStatus` in
`contracts/modules/StatusModule.sol` (S2). Any move not listed reverts with
`InvalidTransition(batchId, from, to)`. Quarantine, release and recall are
implemented in the same module (S3), and so is approval (S4).

## Approval Before First Shipment

By team vote, a batch must be approved by a Regulator before its first
shipment. `approveBatch` sets `approved`, records the approving Regulator and
anchors the certificate hash (replacing the hash given at registration). Until
then, `Created` -> `InTransit` reverts with `NotApproved(batchId)`. Approval is
one-time (`AlreadyApproved`), needs a non-zero hash, and is not possible while
the batch is `Quarantined`, `Recalled` or `Dispensed` (`BatchFrozen`). A bad
batch is quarantined or recalled rather than un-approved.