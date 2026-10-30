// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status} from "./PharmaTypes.sol";
import {IProvenanceTracker} from "./interfaces/IProvenanceTracker.sol";

/// @title ProvenanceTracker (skeleton)
/// @notice Composed from small per-owner module files (AccessRoles, BatchRegistry,
///         StatusModule, CustodyModule, OracleModule) so five people never edit the same
///         file. See docs/architecture.md for the agreed module layout.
/// @dev Stays abstract until the module commits land and are brought together here via
///      multiple inheritance: AccessRoles + BatchRegistry (A4/A5), StatusModule (S2),
///      CustodyModule (N2), OracleModule (B3).
abstract contract ProvenanceTracker is IProvenanceTracker {
    /// @notice Moves a batch to a new status, enforcing the allowed-transition table.
    /// @dev Implemented by Shreyanshi's StatusModule (S2). Called internally by
    ///      CustodyModule (Nandana, N2) and OracleModule (Barath, B3) — never duplicate
    ///      transition logic in another module.
    function _changeStatus(uint256 batchId, Status newStatus) internal virtual;

    /// @notice Quarantines a batch, remembering its prior status for later release.
    /// @dev Implemented by Shreyanshi's StatusModule (S3). Called internally by
    ///      OracleModule (Barath, B3) when a temperature excursion is detected.
    function _quarantine(uint256 batchId, string memory reason) internal virtual;
}
