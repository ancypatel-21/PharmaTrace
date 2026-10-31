// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status, Batch, TempSummary} from "../PharmaTypes.sol";

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

    /// @notice Marks a received batch as stored.
    /// @dev Intended to be called by the batch's current custodian.
    /// @param batchId The unique identifier of the batch.
    function markStored(uint256 batchId) external;

    /// @notice Marks a stored batch as dispensed.
    /// @dev Intended to be called by a Pharmacy that is the current custodian.
    ///      Dispensed is a terminal status.
    /// @param batchId The unique identifier of the batch.
    function markDispensed(uint256 batchId) external;

    /// @notice Quarantines a batch for a specified reason.
    /// @dev Intended to be called by an authorized Regulator. The batch's status
    ///      before quarantine is preserved so it can be restored if the quarantine
    ///      is later released.
    /// @param batchId The unique identifier of the batch.
    /// @param reason The reason for quarantining the batch.
    function quarantineBatch(uint256 batchId, string calldata reason) external;

    /// @notice Releases a quarantined batch and restores its previous status.
    /// @dev Intended to be called by an authorized Regulator.
    /// @param batchId The unique identifier of the quarantined batch.
    function releaseQuarantine(uint256 batchId) external;

    /// @notice Recalls a batch for a specified reason.
    /// @dev Intended to be called by an authorized Regulator. Recalled is a
    ///      terminal status and no further status transitions are allowed.
    /// @param batchId The unique identifier of the batch.
    /// @param reason The reason for recalling the batch.
    function recallBatch(uint256 batchId, string calldata reason) external;

    /// @notice Approves a batch and anchors its certificate hash on-chain.
    /// @dev Intended to be called by an authorized Regulator.
    /// @param batchId The unique identifier of the batch.
    /// @param certificateHash The cryptographic hash of the batch certificate.
    function approveBatch(uint256 batchId, bytes32 certificateHash) external;

    // ---------------------------------------------------------------------
    // Nandana — custody transfer and provenance history
    // Added in N1 (interface + NatSpec): initiateTransfer, acceptTransfer,
    // optional cancelTransfer, getCustodyHistory, getHistoryLength.
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
    event CustodyTransferCancelled(
        uint256 indexed batchId,
        address indexed from,
        address indexed to
    );

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
    /// @dev Requirements: a handoff is pending, msg.sender is its pendingCustodian, and the
    ///      batch is not frozen (notFrozen, S3). A batch quarantined while in transit (e.g.
    ///      by an oracle excursion) cannot be accepted until a Regulator releases it back
    ///      to InTransit.
    ///      Effects: currentCustodian = msg.sender, pendingCustodian cleared, status moves
    ///      to Received through _changeStatus (S2), and a CustodyRecord is appended to the
    ///      batch's history (N3).
    ///      Emits CustodyTransferAccepted(batchId, previous custodian, msg.sender) and
    ///      StatusChanged.
    /// @param batchId The batch being accepted.
    function acceptTransfer(uint256 batchId) external;

    /// @notice Withdraws a pending handoff before the recipient accepts it.
    /// @dev Optional, pending the team vote. Requirements: a handoff is pending,
    ///      msg.sender is still the currentCustodian, and the batch is not frozen
    ///      (notFrozen, S3), so a quarantined batch stays with the Regulator's decision.
    ///      Effects: pendingCustodian cleared and
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
    function getCustodyHistory(uint256 batchId)
        external
        view
        returns (CustodyRecord[] memory history);

    /// @notice Number of accepted handoffs recorded for a batch.
    /// @dev Cheap count for the UI (e.g. "3 handoffs" on a batch list) without returning
    ///      the whole history array.
    /// @param batchId The batch to read.
    /// @return length Number of entries getCustodyHistory would return.
    function getHistoryLength(uint256 batchId) external view returns (uint256 length);

    // ---------------------------------------------------------------------
    // Barath — oracle temperature reporting
    // Added in B1 (interface + NatSpec): reportTemperature. Implemented by OracleModule (B3).
    // ---------------------------------------------------------------------

    /// @notice Reports one temperature window for a batch, as measured off-chain by the IoT
    ///         simulator, and automatically quarantines the batch on a cold-chain excursion.
    /// @dev Only callable by the Oracle role. The batch must exist and be InTransit, Received
    ///      or Stored; reports for Created, Dispensed, Quarantined or Recalled batches revert,
    ///      as do unknown batch IDs.
    ///
    ///      Temperatures are int16 tenths of a degree Celsius so no decimals are needed
    ///      on-chain: 2.0 C = 20, 8.0 C = 80, -1.5 C = -15. The cold-chain range is 20 to 80
    ///      inclusive; the boundary values themselves are in range.
    ///
    ///      The call stores the summary as the batch's latest `TempSummary` (with
    ///      `reportedAt` set to the block timestamp), increments its report count, and emits
    ///      `TemperatureReported`. If `minTenthsC < 20` or `maxTenthsC > 80` it then also
    ///      emits `TemperatureExcursion` and calls the internal `_quarantine` hook, so the
    ///      batch ends up Quarantined in the same transaction (`BatchQuarantined` and
    ///      `StatusChanged` are emitted by that hook). An in-range report leaves the status
    ///      unchanged.
    ///
    ///      Raw sensor readings never go on-chain. They stay off-chain in `simulator/data/`
    ///      and `readingsHash` (keccak256 of the raw readings JSON) anchors them so anyone
    ///      holding the file can later check it against the chain.
    /// @param batchId The batch the readings belong to.
    /// @param minTenthsC Lowest reading in the window, in tenths of a degree Celsius.
    /// @param maxTenthsC Highest reading in the window, in tenths of a degree Celsius. Must
    ///        be at least `minTenthsC`.
    /// @param readingCount Number of raw readings summarised in the window. Must be non-zero.
    /// @param windowStart Unix timestamp (seconds) of the first reading in the window.
    /// @param windowEnd Unix timestamp (seconds) of the last reading in the window. Must be
    ///        at least `windowStart`.
    /// @param readingsHash keccak256 hash of the raw readings JSON kept off-chain.
    function reportTemperature(
        uint256 batchId,
        int16 minTenthsC,
        int16 maxTenthsC,
        uint32 readingCount,
        uint64 windowStart,
        uint64 windowEnd,
        bytes32 readingsHash
    ) external;

    // ---------------------------------------------------------------------
    // Vigneshkumar — public verification reads
    // Added in V1 (interface + NatSpec): read-only views for the public verify page,
    // e.g. an aggregated getBatchSummary(id) if it simplifies the UI.
    // ---------------------------------------------------------------------

    /// @notice Everything the public verify page shows for a batch, in a single call.
    /// @dev Aggregates getBatch, getLatestTemperature and the approver recorded by
    ///      approveBatch (S4) so a consumer's phone makes one RPC request instead of three.
    ///      Does not revert for unknown IDs: returns exists = false and zero values so the
    ///      page can show "Not found" without catching a revert. Custody history is not
    ///      included; the page reads it through getCustodyHistory (N3) and events.
    /// @param batchId The batch ID, as printed in the batch QR code (/verify/:id).
    /// @return exists False if no batch has this ID; all other values are then zero.
    /// @return batch The stored batch: product, lot, expiry, manufacturer, current
    ///         custodian, status, approved flag and certificate hash.
    /// @return latestTemperature The most recent oracle temperature window, or a zero
    ///         struct (reportedAt == 0) if no report has been made yet.
    /// @return temperatureReportCount Number of temperature reports received for the batch.
    /// @return approvedBy The Regulator that approved the batch, or address(0) if not approved.
    function getBatchSummary(uint256 batchId)
        external
        view
        returns (
            bool exists,
            Batch memory batch,
            TempSummary memory latestTemperature,
            uint256 temperatureReportCount,
            address approvedBy
        );

    /// @notice The latest temperature summary reported by the Oracle for a batch.
    /// @dev Reads the TempSummary and report count stored by OracleModule (B3). Full
    ///      report history is in TemperatureReported / TemperatureExcursion events.
    ///      Temperatures are tenths of a degree Celsius (80 = 8.0 C).
    /// @param batchId The batch to read.
    /// @return summary The most recent window, or a zero struct (reportedAt == 0) if none.
    /// @return reportCount Number of temperature reports received for the batch.
    function getLatestTemperature(uint256 batchId)
        external
        view
        returns (TempSummary memory summary, uint256 reportCount);
}
