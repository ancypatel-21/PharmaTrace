// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status} from "../PharmaTypes.sol";
import {ProvenanceTracker} from "../ProvenanceTracker.sol";

/// @title StatusTestHarness (test only, never deployed)
/// @notice The full ProvenanceTracker plus wrappers that expose StatusModule internals, so the
///         S5 tests (test/status.test.js) can drive the complete from/to transition matrix
///         directly. Every wrapper calls the real internal function; nothing is reimplemented.
contract StatusTestHarness is ProvenanceTracker {
    /// @dev Calls the real _changeStatus (S2), with no role checks.
    function exposedChangeStatus(uint256 batchId, Status newStatus) external {
        _changeStatus(batchId, newStatus);
    }

    /// @dev Calls the real _quarantine hook (S3) the way the oracle module does.
    function exposedQuarantine(uint256 batchId, string calldata reason) external {
        _quarantine(batchId, reason);
    }

    /// @dev Runs the real notFrozen modifier (S3); returns true if the batch is not frozen.
    function exposedNotFrozen(uint256 batchId) external view notFrozen(batchId) returns (bool) {
        return true;
    }
}
