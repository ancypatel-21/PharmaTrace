// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Shared enums and structs for the PharmaTrace ProvenanceTracker contract.
//
// Frozen at the 10/30 kickoff meeting per the team work plan. Any later change to this
// file needs a WhatsApp heads-up and a team OK, then scripts/export-abi.js (A7) re-run so
// the web app and simulator pick up the change.

/// @notice Lifecycle states a batch can be in.
/// @dev Terminal states: Dispensed, Recalled. Quarantined is temporary and can be
///      released back to the status it was in before quarantine.
enum Status {
    Created,
    InTransit,
    Received,
    Stored,
    Dispensed,
    Quarantined,
    Recalled
}

/// @notice A single tracked medicine batch.
struct Batch {
    uint256 id;
    string productName;
    string lotNumber;
    uint64 expiryDate;
    address manufacturer;
    address currentCustodian;
    address pendingCustodian;
    Status status;
    bool approved;
    bytes32 certificateHash;
    uint64 createdAt;
}

/// @notice Latest temperature window reported by the Oracle role for a batch.
/// @dev Temperatures are tenths of a degree Celsius (2.0 C = 20, 8.0 C = 80) so no
///      decimals are needed on-chain. Raw sensor readings stay off-chain in the
///      simulator; readingsHash anchors them for later verification.
struct TempSummary {
    int16 minTenthsC;
    int16 maxTenthsC;
    uint32 readingCount;
    uint64 windowStart;
    uint64 windowEnd;
    bytes32 readingsHash;
    uint64 reportedAt;
}
