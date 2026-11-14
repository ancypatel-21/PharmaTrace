// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Batch, TempSummary} from "./PharmaTypes.sol";
import {CustodyModule} from "./modules/CustodyModule.sol";
import {OracleModule} from "./modules/OracleModule.sol";

/// @title ProvenanceTracker
/// @notice The deployable PharmaTrace contract. Composed from small per-owner module files
///         (AccessRoles, BatchRegistry, StatusModule, CustodyModule, OracleModule) so five
///         people never edit the same file: role-based access control (AccessRoles), batch
///         registration (BatchRegistry), the status state machine with quarantine, recall and
///         regulator approval (StatusModule), custody transfers and history (CustodyModule)
///         and oracle temperature reporting (OracleModule). See docs/architecture.md for the
///         full module layout.
/// @dev StatusModule implements the shared internal hooks _changeStatus (S2) and _quarantine
///      (S3); OracleModule (B3) calls _quarantine on a temperature excursion. The deployer
///      holds DEFAULT_ADMIN_ROLE (AccessRoles constructor).
contract ProvenanceTracker is CustodyModule, OracleModule {
    /// @notice Everything the public verify page shows for a batch, in a single call.
    /// @dev Aggregates getBatch, getLatestTemperature (B3) and the approver recorded by
    ///      approveBatch (S4), so a consumer's phone makes one RPC request instead of three.
    ///      Lives here rather than in one module because it reads storage from several.
    ///      Does not revert for unknown IDs: returns exists = false and zero values so the page
    ///      can show "Not found" without catching a revert. Custody history is not included;
    ///      the page reads it through getCustodyHistory (N3) and events.
    /// @param batchId The batch ID, as printed in the batch QR code (/verify/:id).
    /// @return exists False if no batch has this ID; all other values are then zero.
    /// @return batch The stored batch.
    /// @return latestTemperature The most recent oracle window, or a zero struct if none.
    /// @return temperatureReportCount Number of temperature reports received for the batch.
    /// @return approvedBy The Regulator that approved the batch, or address(0) if not approved.
    function getBatchSummary(uint256 batchId)
        external
        view
        override
        returns (
            bool exists,
            Batch memory batch,
            TempSummary memory latestTemperature,
            uint256 temperatureReportCount,
            address approvedBy
        )
    {
        if (!_batchExists(batchId)) {
            return (false, batch, latestTemperature, 0, address(0));
        }
        return (
            true,
            _batches[batchId],
            _latestTemperature[batchId],
            _temperatureReportCount[batchId],
            _approvedBy[batchId]
        );
    }
}
