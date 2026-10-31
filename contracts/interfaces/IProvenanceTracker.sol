// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status, Batch} from "../PharmaTypes.sol";

/// @title IProvenanceTracker
/// @notice Public interface for the PharmaTrace ProvenanceTracker contract.
/// @dev Event names and parameters below are agreed at project kickoff (A2) and are shared
///      across every module. Each function section is owned by one team member, who adds
///      their own signatures and NatSpec to this file in their own commit (N1, S1, B1, V1).
///      Changing an event name or an already-declared signature requires a WhatsApp
///      heads-up and a team OK (see docs/architecture.md and the "Contract changes" rule
///      in the team work plan), then scripts/export-abi.js (A7) re-run.
interface IProvenanceTracker {
    // ---------------------------------------------------------------------
    // Events (shared — every module emits from this fixed set)
    // ---------------------------------------------------------------------

    /// @notice A new participant was granted a role by the admin.
    event ParticipantRegistered(address indexed account, bytes32 indexed role, string name);

    /// @notice A new batch was registered by a Manufacturer.
    event BatchRegistered(uint256 indexed batchId, address indexed manufacturer, string lotNumber);

    /// @notice The current custodian initiated a handoff; batch moves to InTransit.
    event CustodyTransferInitiated(uint256 indexed batchId, address indexed from, address indexed to);

    /// @notice The pending custodian accepted a handoff; batch moves to Received.
    event CustodyTransferAccepted(uint256 indexed batchId, address indexed from, address indexed to);

    /// @notice A batch moved from one status to another.
    event StatusChanged(uint256 indexed batchId, Status from, Status to, address indexed actor);

    /// @notice The Oracle role reported a temperature summary for a batch.
    event TemperatureReported(uint256 indexed batchId, int16 minTenthsC, int16 maxTenthsC, uint32 readingCount);

    /// @notice A reported temperature fell outside the 2-8 C cold-chain range.
    event TemperatureExcursion(uint256 indexed batchId, int16 minTenthsC, int16 maxTenthsC);

    /// @notice A batch was quarantined, by a Regulator or automatically by an excursion.
    event BatchQuarantined(uint256 indexed batchId, string reason, Status previousStatus);

    /// @notice A quarantined batch was released back to its prior status.
    event QuarantineReleased(uint256 indexed batchId, Status restoredStatus);

    /// @notice A batch was recalled. Terminal — no further transitions.
    event BatchRecalled(uint256 indexed batchId, string reason);

    /// @notice A Regulator approved a batch and anchored its certificate hash.
    event BatchApproved(uint256 indexed batchId, address indexed approvedBy, bytes32 certificateHash);

    // ---------------------------------------------------------------------
    // Ancy — roles, registration, access control (AccessRoles, BatchRegistry)
    // Added in A4/A5.
    // ---------------------------------------------------------------------

    function registerParticipant(address account, bytes32 role, string calldata name) external;

    function revokeParticipant(address account) external;

    function registerBatch(
        string calldata productName,
        string calldata lotNumber,
        uint64 expiryDate,
        bytes32 certificateHash
    ) external returns (uint256 batchId);

    function getBatch(uint256 batchId) external view returns (Batch memory);

    function batchExists(uint256 batchId) external view returns (bool);

    function totalBatches() external view returns (uint256);

    // ---------------------------------------------------------------------
    // Shreyanshi — status transitions, quarantine/recall, regulator workflow
    // Added in S1 (interface + NatSpec): markStored, markDispensed, quarantineBatch,
    // releaseQuarantine, recallBatch, approveBatch.
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Nandana — custody transfer and provenance history
    // Added in N1 (interface + NatSpec): initiateTransfer, acceptTransfer,
    // optional cancelTransfer, getCustodyHistory.
    //
    // Every handoff is two-step: the current custodian sends (initiateTransfer), then the
    // recipient signs for it (acceptTransfer). Custody only changes once both sides have
    // signed. Implemented in CustodyModule (N2, N3).
    //
    // Allowed hops (sender role -> recipient role):
    //
    //   Manufacturer -> Distributor or Carrier
    //   Distributor  -> Carrier or Pharmacy
    //   Carrier      -> Distributor or Pharmacy
    //   Pharmacy     -> none (final holder; the batch ends as Dispensed, see markDispensed)
    //
    // Roles are checked with AccessRoles (A4). If an account holds more than one role, the
    // hop is allowed when any role it holds permits it.
    // ---------------------------------------------------------------------

    /// @notice One completed handoff in a batch's custody history.
    /// @dev Declared here rather than in PharmaTypes.sol so the frozen shared types stay
    ///      unchanged. Kept small on purpose: one record per accepted handoff, while the
    ///      full detail (initiation time, cancellations) lives in events. This storage vs.
    ///      events trade-off is measured in the gas report (A10).
    struct CustodyRecord {
        address from; // custodian who sent the batch
        address to; // custodian who accepted it
        uint64 timestamp; // block time of the acceptance
        Status statusAfter; // batch status right after the handoff (Received)
    }

    /// @notice The sender withdrew a pending handoff before the recipient accepted it.
    /// @dev Only emitted if the team keeps cancelTransfer (vote at the weekly meeting).
    event CustodyTransferCancelled(uint256 indexed batchId, address indexed from, address indexed to);

    /// @notice Caller is not the batch's current custodian.
    error NotCurrentCustodian(uint256 batchId, address caller);

    /// @notice Recipient is the zero address, the sender itself, or does not hold a role
    ///         that the sender's role may hand off to (see the hop table above).
    error InvalidNextHop(uint256 batchId, address to);

    /// @notice The batch already has a handoff waiting to be accepted.
    error TransferAlreadyPending(uint256 batchId, address pendingCustodian);

    /// @notice The batch has no handoff waiting to be accepted or cancelled.
    error NoPendingTransfer(uint256 batchId);

    /// @notice Caller is not the recipient named in the pending handoff.
    error NotPendingCustodian(uint256 batchId, address caller);

    /// @notice Starts a handoff: the current custodian names the next custodian.
    /// @dev Requirements:
    ///      - the batch exists (A5) and is not Quarantined, Recalled or Dispensed
    ///        (Shreyanshi's notFrozen modifier, S3);
    ///      - msg.sender is the batch's currentCustodian;
    ///      - `to` holds a role the sender's role may hand off to (hop table above);
    ///      - no other handoff is pending (pendingCustodian is address(0)).
    ///      Effects: sets pendingCustodian = to and moves the status to InTransit through
    ///      _changeStatus (S2), which allows this from Created, Received or Stored.
    ///      Emits CustodyTransferInitiated and StatusChanged.
    ///      If the team votes that a batch must be approved before its first shipment (S4),
    ///      this function also requires batch.approved.
    /// @param batchId The batch being handed off.
    /// @param to The next custodian; must accept with acceptTransfer.
    function initiateTransfer(uint256 batchId, address to) external;

    /// @notice Completes a handoff: the named recipient signs for the batch.
    /// @dev Requirements: a handoff is pending and msg.sender is its pendingCustodian.
    ///      A batch quarantined while in transit (e.g. by an oracle excursion) cannot be
    ///      accepted until a Regulator releases it.
    ///      Effects: currentCustodian = msg.sender, pendingCustodian cleared, status moves
    ///      to Received through _changeStatus (S2), and a CustodyRecord is appended to the
    ///      batch's history (N3).
    ///      Emits CustodyTransferAccepted(batchId, previous custodian, msg.sender) and
    ///      StatusChanged.
    /// @param batchId The batch being accepted.
    function acceptTransfer(uint256 batchId) external;

    /// @notice Withdraws a pending handoff before the recipient accepts it.
    /// @dev Optional, pending the team vote. Requirements: a handoff is pending and
    ///      msg.sender is still the currentCustodian. Effects: pendingCustodian cleared and
    ///      the status returns to what it was before initiateTransfer. That reverse move
    ///      (InTransit -> Created/Received/Stored) is not in the S2 transition table yet and
    ///      needs Shreyanshi's OK. Emits CustodyTransferCancelled and StatusChanged.
    /// @param batchId The batch whose pending handoff is withdrawn.
    function cancelTransfer(uint256 batchId) external;

    /// @notice Full custody history of a batch, oldest handoff first.
    /// @dev Contains only accepted handoffs; the first holder is batch.manufacturer from
    ///      getBatch. Returns an empty array for a batch that has not been handed off yet
    ///      or for an unknown ID (the verify page checks existence with getBatchSummary).
    ///      Used by the custody timeline component (N6) and the public verify page (V3).
    /// @param batchId The batch to read.
    /// @return history Handoffs in the order they were accepted.
    function getCustodyHistory(uint256 batchId) external view returns (CustodyRecord[] memory history);

    /// @notice Number of accepted handoffs recorded for a batch.
    /// @dev Lets the UI page through long histories without loading the whole array.
    /// @param batchId The batch to read.
    /// @return length Number of entries getCustodyHistory would return.
    function getHistoryLength(uint256 batchId) external view returns (uint256 length);

    // ---------------------------------------------------------------------
    // Barath — oracle temperature reporting
    // Added in B1 (interface + NatSpec): reportTemperature.
    // ---------------------------------------------------------------------

    // ---------------------------------------------------------------------
    // Vigneshkumar — public verification reads
    // Added in V1 (interface + NatSpec): read-only views for the public verify page,
    // e.g. an aggregated getBatchSummary(id) if it simplifies the UI.
    // ---------------------------------------------------------------------
}
