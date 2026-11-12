// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {StatusModule} from "./modules/StatusModule.sol";

/// @title ProvenanceTracker (in progress)
/// @notice Composed from small per-owner module files (AccessRoles, BatchRegistry,
///         StatusModule, CustodyModule, OracleModule) so five people never edit the same
///         file. Currently combines role-based access control (AccessRoles), batch
///         registration (BatchRegistry) and the status state machine (StatusModule) through
///         inheritance. See docs/architecture.md for the full, eventual module layout.
/// @dev Stays abstract until the remaining modules land: StatusModule implements
///      _changeStatus (S2) and will implement _quarantine below (S3), and CustodyModule /
///      OracleModule implement the rest of IProvenanceTracker.
abstract contract ProvenanceTracker is StatusModule {
    /// @notice Quarantines a batch, remembering its prior status for later release.
    /// @dev Implemented by the status module. Called internally by the oracle module when a
    ///      temperature excursion is detected.
    function _quarantine(uint256 batchId, string memory reason) internal virtual;
}
