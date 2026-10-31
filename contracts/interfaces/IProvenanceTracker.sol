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
    // optional cancelTransfer, getCustodyHistory.
    // ---------------------------------------------------------------------

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