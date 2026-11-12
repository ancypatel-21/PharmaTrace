// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status} from "./PharmaTypes.sol";
import {BatchRegistry} from "./modules/BatchRegistry.sol";

/// @title ProvenanceTracker (in progress)
/// @notice Composed from small per-owner module files (AccessRoles, BatchRegistry,
///         StatusModule, CustodyModule, OracleModule) so five people never edit the same
///         file. Currently combines role-based access control (AccessRoles) and batch
///         registration (BatchRegistry) through inheritance. See docs/architecture.md for the
///         full, eventual module layout.
/// @dev Stays abstract until the remaining modules land: StatusModule implements
///      _changeStatus and _quarantine below, and CustodyModule / OracleModule implement the
///      rest of IProvenanceTracker.
abstract contract ProvenanceTracker is BatchRegistry {
    /// @notice Moves a batch to a new status, enforcing the allowed-transition table.
    /// @dev Implemented by the status module. Called internally by the custody and oracle
    ///      modules — never duplicate transition logic in another module.
    function _changeStatus(uint256 batchId, Status newStatus) internal virtual;

    /// @notice Quarantines a batch, remembering its prior status for later release.
    /// @dev Implemented by the status module. Called internally by the oracle module when a
    ///      temperature excursion is detected.
    function _quarantine(uint256 batchId, string memory reason) internal virtual;
}
