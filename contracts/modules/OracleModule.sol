// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status, TempSummary} from "../PharmaTypes.sol";
import {StatusModule} from "./StatusModule.sol";

/// @title OracleModule
/// @notice Temperature reporting by the Oracle role. The off-chain IoT simulator summarises a
///         window of sensor readings and reports it here; a window outside the 2-8 C cold-chain
///         range quarantines the batch automatically, in the same transaction.
/// @dev Abstract: implements the reportTemperature / getLatestTemperature slice of
///      IProvenanceTracker. Only the latest summary and a report count are stored on-chain;
///      the full history of reports lives in the TemperatureReported / TemperatureExcursion
///      events, and the raw readings stay off-chain, anchored by readingsHash. Quarantining
///      goes through _quarantine (S3), so the transition table in StatusModule stays the single
///      source of truth.
///
///      Temperatures are int16 tenths of a degree Celsius (2.0 C = 20, 8.0 C = 80), so no
///      decimals are needed on-chain. The range is inclusive: 20 and 80 are in range.
abstract contract OracleModule is StatusModule {
    /// @notice Lowest in-range temperature, in tenths of a degree Celsius (2.0 C).
    int16 public constant MIN_SAFE_TENTHS_C = 20;

    /// @notice Highest in-range temperature, in tenths of a degree Celsius (8.0 C).
    int16 public constant MAX_SAFE_TENTHS_C = 80;

    /// @notice A temperature report is only accepted while the batch is in the cold chain:
    ///         InTransit, Received or Stored.
    error BatchNotReportable(uint256 batchId, Status status);

    /// @notice `minTenthsC` is greater than `maxTenthsC`.
    error InvalidTemperatureRange(int16 minTenthsC, int16 maxTenthsC);

    /// @notice `readingCount` is zero, or `windowStart` is after `windowEnd`.
    error InvalidReadingWindow(uint32 readingCount, uint64 windowStart, uint64 windowEnd);

    /// @dev batchId => the most recent temperature window. reportedAt == 0 means none yet.
    ///      Internal, not private, so the verify-page aggregate view can read it once combined
    ///      into ProvenanceTracker.sol.
    mapping(uint256 => TempSummary) internal _latestTemperature;

    /// @dev batchId => number of temperature reports received.
    mapping(uint256 => uint256) internal _temperatureReportCount;

    /// @notice Reports one temperature window for a batch and quarantines it on an excursion.
    /// @dev Oracle only. Reverts with AccessControlUnauthorizedAccount, UnknownBatch,
    ///      BatchNotReportable (Created, Dispensed, Quarantined or Recalled batch),
    ///      InvalidTemperatureRange (min above max) or InvalidReadingWindow (zero readings or
    ///      window ending before it starts). Stores the summary with reportedAt set to the
    ///      block timestamp, increments the report count and emits TemperatureReported. If
    ///      min < 20 or max > 80 it then emits TemperatureExcursion and calls _quarantine, so
    ///      the batch is Quarantined when the transaction ends (BatchQuarantined and
    ///      StatusChanged come from the hook). An in-range report leaves the status unchanged.
    /// @param batchId The batch the readings belong to.
    /// @param minTenthsC Lowest reading in the window, in tenths of a degree Celsius.
    /// @param maxTenthsC Highest reading in the window, in tenths of a degree Celsius.
    /// @param readingCount Number of raw readings summarised in the window.
    /// @param windowStart Unix timestamp (seconds) of the first reading in the window.
    /// @param windowEnd Unix timestamp (seconds) of the last reading in the window.
    /// @param readingsHash keccak256 hash of the raw readings JSON kept off-chain.
    function reportTemperature(
        uint256 batchId,
        int16 minTenthsC,
        int16 maxTenthsC,
        uint32 readingCount,
        uint64 windowStart,
        uint64 windowEnd,
        bytes32 readingsHash
    ) external override onlyRole(ORACLE_ROLE) {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);

        Status status = _batches[batchId].status;
        if (status != Status.InTransit && status != Status.Received && status != Status.Stored) {
            revert BatchNotReportable(batchId, status);
        }

        if (minTenthsC > maxTenthsC) revert InvalidTemperatureRange(minTenthsC, maxTenthsC);
        if (readingCount == 0 || windowStart > windowEnd) {
            revert InvalidReadingWindow(readingCount, windowStart, windowEnd);
        }

        _latestTemperature[batchId] = TempSummary({
            minTenthsC: minTenthsC,
            maxTenthsC: maxTenthsC,
            readingCount: readingCount,
            windowStart: windowStart,
            windowEnd: windowEnd,
            readingsHash: readingsHash,
            reportedAt: uint64(block.timestamp)
        });
        _temperatureReportCount[batchId]++;

        emit TemperatureReported(batchId, minTenthsC, maxTenthsC, readingCount);

        if (minTenthsC < MIN_SAFE_TENTHS_C || maxTenthsC > MAX_SAFE_TENTHS_C) {
            emit TemperatureExcursion(batchId, minTenthsC, maxTenthsC);
            _quarantine(batchId, "Temperature excursion: outside 2-8 C");
        }
    }

    /// @notice The latest temperature summary reported by the Oracle for a batch.
    /// @dev Does not revert for unknown batches or batches with no report: returns a zero
    ///      struct (reportedAt == 0) and a count of zero. Temperatures are tenths of a degree
    ///      Celsius (80 = 8.0 C).
    /// @param batchId The batch to read.
    /// @return summary The most recent window, or a zero struct if none.
    /// @return reportCount Number of temperature reports received for the batch.
    function getLatestTemperature(uint256 batchId)
        external
        view
        override
        returns (TempSummary memory summary, uint256 reportCount)
    {
        return (_latestTemperature[batchId], _temperatureReportCount[batchId]);
    }
}
