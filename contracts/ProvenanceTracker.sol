// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CustodyModule} from "./modules/CustodyModule.sol";
import {OracleModule} from "./modules/OracleModule.sol";

/// @title ProvenanceTracker (in progress)
/// @notice Composed from small per-owner module files (AccessRoles, BatchRegistry,
///         StatusModule, CustodyModule, OracleModule) so five people never edit the same
///         file. Currently combines role-based access control (AccessRoles), batch
///         registration (BatchRegistry), the status state machine with quarantine and recall
///         (StatusModule), custody transfers (CustodyModule) and oracle temperature reporting
///         (OracleModule) through inheritance. See docs/architecture.md for the full module
///         layout.
/// @dev Stays abstract until the remaining interface functions land: approveBatch (S4) and the
///      verify-page getBatchSummary. StatusModule implements the shared internal hooks
///      _changeStatus (S2) and _quarantine (S3); OracleModule (B3) calls _quarantine on a
///      temperature excursion.
abstract contract ProvenanceTracker is CustodyModule, OracleModule {}
