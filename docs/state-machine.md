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
| `Created` | `InTransit` | Current custodian | A custody transfer is initiated for a newly created batch. |
| `InTransit` | `Received` | Pending custodian | The recipient accepts the custody transfer. |
| `Received` | `Stored` | Current custodian | The current custodian marks the received batch as stored. |
| `Received` | `InTransit` | Current custodian | The current custodian initiates the next custody transfer. |
| `Stored` | `InTransit` | Current custodian | A stored batch is sent to the next participant in the supply chain. |
| `Stored` | `Dispensed` | Pharmacy | The pharmacy dispenses the batch. `Dispensed` is a terminal status. |
| Any non-terminal status | `Quarantined` | Regulator or authorized Oracle path | The batch is quarantined manually by a Regulator or automatically after a temperature excursion. |
| `Quarantined` | Previous status | Regulator | The Regulator releases the quarantine and restores the status held immediately before quarantine. |
| `Quarantined` | `Recalled` | Regulator | The Regulator recalls a quarantined batch. `Recalled` is a terminal status. |

## Quarantine Behavior

When a batch enters `Quarantined`, PharmaTrace preserves the status that the
batch had immediately before quarantine. If an authorized Regulator later
releases the quarantine, the batch returns to that previous status.

The Oracle path may automatically quarantine a batch when a reported
temperature falls outside the required 2-8 C cold-chain range.

## Terminal States

`Dispensed` and `Recalled` are terminal states. Once a batch reaches either
status, no further status transitions are allowed.

## Regulator Actions

An authorized Regulator is intended to perform the following actions:

- Quarantine a batch using `quarantineBatch`.
- Release a quarantined batch using `releaseQuarantine`.
- Recall a batch using `recallBatch`.
- Approve a batch and anchor its certificate hash using `approveBatch`.

The detailed access-control checks and status-transition logic will be
implemented in later contract modules.