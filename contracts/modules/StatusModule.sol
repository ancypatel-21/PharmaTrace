// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status, Batch} from "../PharmaTypes.sol";
import {BatchRegistry} from "./BatchRegistry.sol";

/// @title StatusModule
/// @notice Batch status state machine. Every status change in PharmaTrace goes through
///         _changeStatus, which enforces the allowed-transition table in
///         docs/state-machine.md and emits StatusChanged.
/// @dev Abstract: implements _changeStatus plus the markStored / markDispensed slice of
///      IProvenanceTracker. The custody module (N2) calls _changeStatus to move a batch to
///      InTransit and Received; quarantine, release and recall (S3) and the oracle path (B3)
///      also go through it. Never duplicate transition logic in another module.
///
///      Allowed transitions:
///        Created            -> InTransit
///        InTransit          -> Received | status held before InTransit (cancelled handoff)
///        Received           -> Stored | InTransit (next hop)
///        Stored             -> InTransit (next hop) | Dispensed
///        any non-terminal   -> Quarantined
///        Quarantined        -> status held before quarantine (release) | Recalled
///        Dispensed, Recalled are terminal.
abstract contract StatusModule is BatchRegistry {
    /// @notice The move from `from` to `to` is not in the allowed-transition table.
    error InvalidTransition(uint256 batchId, Status from, Status to);

    /// @dev batchId => the status the batch held right before it entered Quarantined.
    ///      Written by _changeStatus whenever a batch is quarantined, so a release can only
    ///      restore that exact status. Read by the quarantine/recall logic (S3).
    mapping(uint256 => Status) internal _statusBeforeQuarantine;

    /// @dev batchId => the status the batch held right before it entered InTransit
    ///      (Created, Received or Stored). Written by _changeStatus whenever a handoff starts,
    ///      so a cancelled handoff (cancelTransfer, N2) can only return the batch to that
    ///      exact status and not jump to any other earlier state.
    mapping(uint256 => Status) internal _statusBeforeTransit;

    /// @notice Marks a received batch as stored.
    /// @dev Current custodian only. Allowed only from Received (Received -> Stored).
    ///      Reverts with UnknownBatch, NotCurrentCustodian or InvalidTransition.
    /// @param batchId The unique identifier of the batch.
    function markStored(uint256 batchId) external override {
        _requireCurrentCustodian(batchId);
        _changeStatus(batchId, Status.Stored);
    }

    /// @notice Marks a stored batch as dispensed. Dispensed is terminal.
    /// @dev Caller must hold PHARMACY_ROLE and be the batch's current custodian. Allowed only
    ///      from Stored (Stored -> Dispensed). Reverts with AccessControlUnauthorizedAccount,
    ///      UnknownBatch, NotCurrentCustodian or InvalidTransition.
    /// @param batchId The unique identifier of the batch.
    function markDispensed(uint256 batchId) external override onlyRole(PHARMACY_ROLE) {
        _requireCurrentCustodian(batchId);
        _changeStatus(batchId, Status.Dispensed);
    }

    /// @notice Moves a batch to `newStatus`, enforcing the allowed-transition table.
    /// @dev Internal hook shared with the custody, quarantine and oracle code. Callers are
    ///      responsible for their own role checks; this function only checks that the batch
    ///      exists and that the transition is allowed. Records the previous status when
    ///      entering Quarantined (for release) or entering InTransit from Created, Received
    ///      or Stored (for a cancelled handoff). Emits StatusChanged(batchId, from, to,
    ///      msg.sender).
    ///      Note: when the pre-transit status was Received, InTransit -> Received is both a
    ///      normal accept and a cancel; the custody module decides which one it is.
    /// @param batchId The batch to update.
    /// @param newStatus The status to move to.
    function _changeStatus(uint256 batchId, Status newStatus) internal virtual {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);

        Batch storage batch = _batches[batchId];
        Status from = batch.status;

        if (!_isAllowedTransition(batchId, from, newStatus)) {
            revert InvalidTransition(batchId, from, newStatus);
        }

        if (newStatus == Status.Quarantined) {
            _statusBeforeQuarantine[batchId] = from;
        } else if (newStatus == Status.InTransit && from != Status.Quarantined) {
            // A release from quarantine back to InTransit keeps the original pre-transit
            // status, so the handoff can still be cancelled afterwards.
            _statusBeforeTransit[batchId] = from;
        }

        batch.status = newStatus;
        emit StatusChanged(batchId, from, newStatus, msg.sender);
    }

    /// @dev Whether `from -> to` is allowed for this batch. Quarantined -> X depends on the
    ///      batch's recorded pre-quarantine status, so this is a view, not pure.
    function _isAllowedTransition(uint256 batchId, Status from, Status to)
        internal
        view
        returns (bool)
    {
        if (from == Status.Created) {
            return to == Status.InTransit || to == Status.Quarantined;
        }
        if (from == Status.InTransit) {
            return to == Status.Received
                || to == Status.Quarantined
                || to == _statusBeforeTransit[batchId];
        }
        if (from == Status.Received) {
            return to == Status.Stored || to == Status.InTransit || to == Status.Quarantined;
        }
        if (from == Status.Stored) {
            return to == Status.InTransit || to == Status.Dispensed || to == Status.Quarantined;
        }
        if (from == Status.Quarantined) {
            return to == Status.Recalled || to == _statusBeforeQuarantine[batchId];
        }
        // Dispensed and Recalled are terminal.
        return false;
    }

    /// @dev Reverts with UnknownBatch or NotCurrentCustodian.
    function _requireCurrentCustodian(uint256 batchId) internal view {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);
        if (_batches[batchId].currentCustodian != msg.sender) {
            revert NotCurrentCustodian(batchId, msg.sender);
        }
    }
}
