// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status, Batch} from "../PharmaTypes.sol";
import {StatusModule} from "./StatusModule.sol";

/// @title CustodyModule
/// @notice Two-step custody transfers: the current custodian sends a batch
///         (initiateTransfer), and the named recipient signs for it (acceptTransfer). Custody
///         only changes once both sides have signed. The sender can withdraw a handoff that
///         has not been accepted yet (cancelTransfer).
/// @dev Abstract: implements the initiateTransfer / acceptTransfer / cancelTransfer slice of
///      IProvenanceTracker. Every status move goes through _changeStatus (S2), so the
///      transition table in StatusModule is the single source of truth:
///        - a Quarantined, Recalled or Dispensed batch cannot be sent, accepted or cancelled,
///          because no move out of those statuses into InTransit, Received or the pre-transit
///          status is allowed (reverts with InvalidTransition);
///        - a batch quarantined while in transit keeps its pending handoff, and once a
///          Regulator releases it back to InTransit it can be accepted or cancelled as usual.
///
///      Allowed hops (sender role -> recipient role):
///        Manufacturer -> Distributor | Carrier
///        Distributor  -> Carrier | Pharmacy
///        Carrier      -> Distributor | Pharmacy
///        Pharmacy     -> none (final holder)
///      An account holding several roles may make any hop one of its roles allows. The hop is
///      checked again when the recipient accepts, so if either side's role is revoked in
///      between, custody does not move (the sender can still cancel).
///
///      Provenance history (N3): every accepted handoff appends one CustodyRecord
///      {from, to, timestamp, statusAfter} to an append-only array per batch. On-chain
///      records are kept this small on purpose; the rest of the story (when a handoff was
///      started, cancelled handoffs, every status change) lives in the CustodyTransfer* and
///      StatusChanged events, which cost far less gas than storage. The gas report (A10)
///      measures this trade-off.
abstract contract CustodyModule is StatusModule {
    /// @dev batchId => accepted handoffs, oldest first. Append-only: never edited or removed.
    mapping(uint256 => CustodyRecord[]) private _custodyHistory;

    /// @notice Starts a handoff: the current custodian names the next custodian.
    /// @dev Reverts with UnknownBatch, NotCurrentCustodian, TransferAlreadyPending,
    ///      InvalidNextHop or InvalidTransition (frozen batch). Sets pendingCustodian, moves
    ///      the batch to InTransit and emits StatusChanged and CustodyTransferInitiated.
    /// @param batchId The batch being handed off.
    /// @param to The next custodian; must accept with acceptTransfer.
    function initiateTransfer(uint256 batchId, address to) external override {
        _requireCurrentCustodian(batchId);

        Batch storage batch = _batches[batchId];
        if (batch.pendingCustodian != address(0)) {
            revert TransferAlreadyPending(batchId, batch.pendingCustodian);
        }
        if (to == address(0) || to == msg.sender || !_isAllowedHop(msg.sender, to)) {
            revert InvalidNextHop(batchId, to);
        }

        batch.pendingCustodian = to;
        _changeStatus(batchId, Status.InTransit);

        emit CustodyTransferInitiated(batchId, msg.sender, to);
    }

    /// @notice Completes a handoff: the named recipient signs for the batch.
    /// @dev Reverts with UnknownBatch, NoPendingTransfer, NotPendingCustodian, InvalidNextHop
    ///      (the hop is no longer allowed because the sender's or the recipient's role was
    ///      revoked after the transfer started) or
    ///      InvalidTransition (the batch was quarantined or recalled in transit). Moves custody
    ///      to msg.sender, clears pendingCustodian, moves the batch to Received, appends a
    ///      CustodyRecord to the batch's history and emits StatusChanged and
    ///      CustodyTransferAccepted.
    /// @param batchId The batch being accepted.
    function acceptTransfer(uint256 batchId) external override {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);

        Batch storage batch = _batches[batchId];
        address to = batch.pendingCustodian;
        if (to == address(0)) revert NoPendingTransfer(batchId);
        if (to != msg.sender) revert NotPendingCustodian(batchId, msg.sender);

        address from = batch.currentCustodian;
        if (!_isAllowedHop(from, msg.sender)) revert InvalidNextHop(batchId, msg.sender);

        batch.currentCustodian = msg.sender;
        batch.pendingCustodian = address(0);
        _changeStatus(batchId, Status.Received);

        _custodyHistory[batchId].push(
            CustodyRecord({
                from: from,
                to: msg.sender,
                timestamp: uint64(block.timestamp),
                statusAfter: batch.status
            })
        );

        emit CustodyTransferAccepted(batchId, from, msg.sender);
    }

    /// @notice Withdraws a pending handoff before the recipient accepts it.
    /// @dev Current custodian (the sender) only, so the recipient can never use this to end
    ///      up back in Received without taking custody. Reverts with UnknownBatch,
    ///      NotCurrentCustodian, NoPendingTransfer or InvalidTransition (frozen batch).
    ///      Clears pendingCustodian, returns the batch to the status it held right before
    ///      InTransit (recorded by _changeStatus) and emits StatusChanged and
    ///      CustodyTransferCancelled.
    /// @param batchId The batch whose pending handoff is withdrawn.
    function cancelTransfer(uint256 batchId) external override {
        _requireCurrentCustodian(batchId);

        Batch storage batch = _batches[batchId];
        address to = batch.pendingCustodian;
        if (to == address(0)) revert NoPendingTransfer(batchId);

        batch.pendingCustodian = address(0);
        _changeStatus(batchId, _statusBeforeTransit[batchId]);

        emit CustodyTransferCancelled(batchId, msg.sender, to);
    }

    /// @notice Full custody history of a batch, oldest handoff first.
    /// @dev Only accepted handoffs; the first holder is batch.manufacturer. Returns an empty
    ///      array for a batch that has not been handed off yet or for an unknown ID, so the
    ///      public verify page never has to catch a revert here.
    /// @param batchId The batch to read.
    /// @return history Handoffs in the order they were accepted.
    function getCustodyHistory(uint256 batchId)
        external
        view
        override
        returns (CustodyRecord[] memory history)
    {
        return _custodyHistory[batchId];
    }

    /// @notice Number of accepted handoffs recorded for a batch (0 for an unknown ID).
    /// @param batchId The batch to read.
    /// @return length Number of entries getCustodyHistory would return.
    function getHistoryLength(uint256 batchId) external view override returns (uint256 length) {
        return _custodyHistory[batchId].length;
    }

    /// @dev Whether `from` may hand a batch to `to`, per the hop table above.
    function _isAllowedHop(address from, address to) internal view returns (bool) {
        if (
            hasRole(MANUFACTURER_ROLE, from)
                && (hasRole(DISTRIBUTOR_ROLE, to) || hasRole(CARRIER_ROLE, to))
        ) {
            return true;
        }
        if (
            hasRole(DISTRIBUTOR_ROLE, from)
                && (hasRole(CARRIER_ROLE, to) || hasRole(PHARMACY_ROLE, to))
        ) {
            return true;
        }
        if (
            hasRole(CARRIER_ROLE, from)
                && (hasRole(DISTRIBUTOR_ROLE, to) || hasRole(PHARMACY_ROLE, to))
        ) {
            return true;
        }
        return false;
    }
}
