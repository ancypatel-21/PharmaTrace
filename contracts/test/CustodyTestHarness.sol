// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status, TempSummary, Batch} from "../PharmaTypes.sol";
import {ProvenanceTracker} from "../ProvenanceTracker.sol";

/// @title CustodyTestHarness (test only, never deployed)
/// @notice Deployable stand-in for ProvenanceTracker so the custody tests (N4) can run before
///         the remaining modules land. ProvenanceTracker stays abstract until S4
///         (approval), B3 (oracle) and the verify views are merged.
/// @dev The unmerged interface functions revert with NotInHarness. Three helpers move a batch
///      into and out of Quarantined/Recalled through the real _changeStatus (S2), so the
///      tests exercise the real transition table rather than a fake one. Delete this file
///      once ProvenanceTracker is concrete and the shared fixture (A6) can deploy it.
contract CustodyTestHarness is ProvenanceTracker {
    error NotInHarness();

    // --- Test helpers (no role checks: test only) ---

    function harnessQuarantine(uint256 batchId) external {
        _changeStatus(batchId, Status.Quarantined);
    }

    function harnessRelease(uint256 batchId) external {
        _changeStatus(batchId, _statusBeforeQuarantine[batchId]);
    }

    function harnessRecall(uint256 batchId) external {
        _changeStatus(batchId, Status.Recalled);
    }

    // --- Not merged yet (S4, B3, verify views) ---
    // Quarantine, release and recall now come from StatusModule (S3).

    function approveBatch(uint256, bytes32) external pure override {
        revert NotInHarness();
    }

    function reportTemperature(uint256, int16, int16, uint32, uint64, uint64, bytes32)
        external
        pure
        override
    {
        revert NotInHarness();
    }

    function getBatchSummary(uint256)
        external
        pure
        override
        returns (bool, Batch memory, TempSummary memory, uint256, address)
    {
        revert NotInHarness();
    }

    function getLatestTemperature(uint256)
        external
        pure
        override
        returns (TempSummary memory, uint256)
    {
        revert NotInHarness();
    }
}
