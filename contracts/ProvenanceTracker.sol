// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CustodyModule} from "./modules/CustodyModule.sol";

/// @title ProvenanceTracker (in progress)
/// @notice Composed from small per-owner module files (AccessRoles, BatchRegistry,
///         StatusModule, CustodyModule, OracleModule) so five people never edit the same
///         file. Currently combines role-based access control (AccessRoles), batch
///         registration (BatchRegistry), the status state machine with quarantine and recall
///         (StatusModule) and custody transfers (CustodyModule) through inheritance. See
///         docs/architecture.md for the full, eventual module layout.
/// @dev Stays abstract until the remaining modules land: StatusModule implements the shared
///      internal hooks _changeStatus (S2) and _quarantine (S3); OracleModule implements the
///      rest of IProvenanceTracker.
abstract contract ProvenanceTracker is CustodyModule {}
