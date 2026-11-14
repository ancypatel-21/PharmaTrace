// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status} from "../PharmaTypes.sol";
import {ProvenanceTracker} from "../ProvenanceTracker.sol";

/// @title CustodyTestHarness (test only, never deployed)
/// @notice The full ProvenanceTracker plus three test helpers used by the custody tests (N4).
///         ProvenanceTracker is now concrete, so every interface function here is the real
///         one; only the helpers below are test-specific.
/// @dev The helpers move a batch into and out of Quarantined/Recalled through the real
///      _changeStatus (S2), without role checks, so the custody tests can set up frozen
///      batches directly. Can be removed once the custody tests switch to the shared fixture
///      (A6) and the real quarantineBatch / releaseQuarantine / recallBatch.
contract CustodyTestHarness is ProvenanceTracker {
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
}
