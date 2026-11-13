// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status, Batch} from "../PharmaTypes.sol";
import {BatchRegistry} from "./BatchRegistry.sol";

/// @title StatusModule
/// @notice Batch status state machine. Every status change in PharmaTrace goes through
///         _changeStatus, which enforces the allowed-transition table in
///         docs/state-machine.md and emits StatusChanged.
/// @dev Abstract: implements _changeStatus, _quarantine and the notFrozen modifier, plus the
///      markStored / markDispensed / quarantineBatch / releaseQuarantine / recallBatch slice
///      of IProvenanceTracker. The custody module (N2) calls _changeStatus to move a batch to
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

    /// @notice The batch is Quarantined, Recalled or Dispensed and cannot be handed off.
    error BatchFrozen(uint256 batchId, Status status);

    /// @notice releaseQuarantine was called on a batch that is not Quarantined.
    error NotQuarantined(uint256 batchId, Status status);

    /// @notice A quarantine or recall reason was empty.
    error EmptyReason();

    /// @notice `caller` is not allowed to recall this batch.
    error RecallNotAuthorized(uint256 batchId, address caller);

    /// @notice Blocks a batch that is Quarantined, Recalled or Dispensed.
    /// @dev Used by the custody module (N2) on initiateTransfer / cancelTransfer so a frozen
    ///      batch cannot move. Reverts with UnknownBatch or BatchFrozen.
    modifier notFrozen(uint256 batchId) {
        _requireNotFrozen(batchId);
        _;
    }

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

    /// @notice Quarantines a batch for a stated reason.
    /// @dev Regulator only. Allowed from any non-terminal status (Created, InTransit,
    ///      Received, Stored); the prior status is remembered so releaseQuarantine can
    ///      restore it. Reverts with AccessControlUnauthorizedAccount, EmptyReason,
    ///      UnknownBatch or InvalidTransition (already Quarantined, Recalled or Dispensed).
    ///      Emits StatusChanged and BatchQuarantined(batchId, reason, previousStatus).
    /// @param batchId The batch to quarantine.
    /// @param reason Why the batch is quarantined; shown on the verify page.
    function quarantineBatch(uint256 batchId, string calldata reason)
        external
        override
        onlyRole(REGULATOR_ROLE)
    {
        if (bytes(reason).length == 0) revert EmptyReason();
        _quarantine(batchId, reason);
    }

    /// @notice Releases a quarantined batch back to the status it held before quarantine.
    /// @dev Regulator only. Reverts with AccessControlUnauthorizedAccount, UnknownBatch or
    ///      NotQuarantined. A pending handoff is kept, so a batch quarantined while InTransit
    ///      returns to InTransit with the same pending recipient.
    ///      Emits StatusChanged and QuarantineReleased(batchId, restoredStatus).
    /// @param batchId The quarantined batch.
    function releaseQuarantine(uint256 batchId) external override onlyRole(REGULATOR_ROLE) {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);
        Status current = _batches[batchId].status;
        if (current != Status.Quarantined) revert NotQuarantined(batchId, current);

        Status restored = _statusBeforeQuarantine[batchId];
        _changeStatus(batchId, restored);
        emit QuarantineReleased(batchId, restored);
    }

    /// @notice Recalls a batch for a stated reason. Recalled is terminal.
    /// @dev Caller must be a Regulator or the batch's own Manufacturer (_canRecall). Allowed from any non-terminal status:
    ///      a batch that is not already Quarantined is first moved to Quarantined and then
    ///      to Recalled in the same transaction, so the transition table keeps Recalled
    ///      reachable only from Quarantined. Both moves emit StatusChanged; BatchQuarantined
    ///      is not emitted for that intermediate step, since it is part of the recall.
    ///      Any pending handoff is cleared, because a recalled batch can never be accepted.
    ///      Reverts with RecallNotAuthorized, EmptyReason, UnknownBatch or InvalidTransition
    ///      (already Recalled or Dispensed). Emits BatchRecalled(batchId, reason).
    /// @param batchId The batch to recall.
    /// @param reason Why the batch is recalled; shown on the verify page.
    function recallBatch(uint256 batchId, string calldata reason) external override {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);
        if (!_canRecall(batchId, msg.sender)) revert RecallNotAuthorized(batchId, msg.sender);
        if (bytes(reason).length == 0) revert EmptyReason();

        Batch storage batch = _batches[batchId];
        if (batch.status != Status.Quarantined) {
            _changeStatus(batchId, Status.Quarantined);
        }
        _changeStatus(batchId, Status.Recalled);
        batch.pendingCustodian = address(0);

        emit BatchRecalled(batchId, reason);
    }

    /// @dev Who may recall `batchId`: any Regulator, or the Manufacturer that registered the
    ///      batch (most real drug recalls are started by the manufacturer). The manufacturer
    ///      must still hold MANUFACTURER_ROLE, so a revoked manufacturer cannot recall.
    ///      Only the Regulator can quarantine or release a batch.
    function _canRecall(uint256 batchId, address caller) internal view virtual returns (bool) {
        if (hasRole(REGULATOR_ROLE, caller)) return true;
        return _batches[batchId].manufacturer == caller && hasRole(MANUFACTURER_ROLE, caller);
    }

    /// @notice Quarantines a batch, remembering its prior status for later release.
    /// @dev Internal hook shared with the oracle module (B3), which calls it on a temperature
    ///      excursion; the caller does its own role check. Reverts with UnknownBatch or
    ///      InvalidTransition. Emits StatusChanged and BatchQuarantined.
    /// @param batchId The batch to quarantine.
    /// @param reason Why the batch is quarantined.
    function _quarantine(uint256 batchId, string memory reason) internal virtual {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);
        Status previous = _batches[batchId].status;
        _changeStatus(batchId, Status.Quarantined);
        emit BatchQuarantined(batchId, reason, previous);
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

    /// @dev Reverts with UnknownBatch or BatchFrozen.
    function _requireNotFrozen(uint256 batchId) internal view {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);
        Status status = _batches[batchId].status;
        if (
            status == Status.Quarantined || status == Status.Recalled
                || status == Status.Dispensed
        ) {
            revert BatchFrozen(batchId, status);
        }
    }

    /// @dev Reverts with UnknownBatch or NotCurrentCustodian.
    function _requireCurrentCustodian(uint256 batchId) internal view {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);
        if (_batches[batchId].currentCustodian != msg.sender) {
            revert NotCurrentCustodian(batchId, msg.sender);
        }
    }
}
