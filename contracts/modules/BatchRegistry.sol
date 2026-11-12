// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Status, Batch} from "../PharmaTypes.sol";
import {AccessRoles} from "./AccessRoles.sol";

/// @title BatchRegistry
/// @notice Batch registration with unique, auto-incrementing IDs. Manufacturer only.
/// @dev Abstract: only implements the registerBatch / getBatch / batchExists / totalBatches
///      slice of IProvenanceTracker (inherited transitively through AccessRoles). Batch
///      storage is `internal`, not `private`, so the modules that land later (status,
///      custody, oracle) can read and mutate a batch's mutable fields once combined into
///      ProvenanceTracker.sol.
abstract contract BatchRegistry is AccessRoles {
    /// @notice `productName` or `lotNumber` was empty.
    error EmptyField();

    /// @notice `expiryDate` is not strictly in the future.
    error ExpiryInPast(uint64 expiryDate);

    /// @notice `manufacturer` already registered a batch with this `lotNumber`.
    /// @dev Lot numbers only need to be unique per manufacturer, not globally.
    error DuplicateLot(address manufacturer, string lotNumber);

    /// @notice No batch exists with this ID.
    error UnknownBatch(uint256 batchId);

    /// @dev batchId => batch. IDs start at 1, so 0 can be used elsewhere as a "no batch"
    ///      sentinel (e.g. a cleared pendingCustodian uses address(0), not a batch sentinel,
    ///      but keeping batch IDs 1-based keeps that convention available).
    mapping(uint256 => Batch) internal _batches;

    /// @dev manufacturer => keccak256(lotNumber) => already used.
    mapping(address => mapping(bytes32 => bool)) private _lotUsed;

    uint256 private _nextBatchId = 1;

    /// @notice Registers a new batch and returns its unique ID.
    /// @dev Manufacturer only. Reverts with EmptyField if productName or lotNumber is empty,
    ///      with ExpiryInPast if expiryDate is not strictly after the current block
    ///      timestamp, and with DuplicateLot if this manufacturer already used this
    ///      lotNumber. The new batch starts as Status.Created with currentCustodian set to
    ///      the calling manufacturer, no pending custodian, and not yet approved.
    function registerBatch(
        string calldata productName,
        string calldata lotNumber,
        uint64 expiryDate,
        bytes32 certificateHash
    ) external override onlyRole(MANUFACTURER_ROLE) returns (uint256 batchId) {
        if (bytes(productName).length == 0 || bytes(lotNumber).length == 0) {
            revert EmptyField();
        }
        if (expiryDate <= block.timestamp) revert ExpiryInPast(expiryDate);

        bytes32 lotKey = keccak256(bytes(lotNumber));
        if (_lotUsed[msg.sender][lotKey]) revert DuplicateLot(msg.sender, lotNumber);
        _lotUsed[msg.sender][lotKey] = true;

        batchId = _nextBatchId++;
        _batches[batchId] = Batch({
            id: batchId,
            productName: productName,
            lotNumber: lotNumber,
            expiryDate: expiryDate,
            manufacturer: msg.sender,
            currentCustodian: msg.sender,
            pendingCustodian: address(0),
            status: Status.Created,
            approved: false,
            certificateHash: certificateHash,
            createdAt: uint64(block.timestamp)
        });

        emit BatchRegistered(batchId, msg.sender, lotNumber);
    }

    /// @notice Reads back a registered batch.
    /// @dev Reverts with UnknownBatch if no batch has this ID.
    function getBatch(uint256 batchId) external view override returns (Batch memory) {
        if (!_batchExists(batchId)) revert UnknownBatch(batchId);
        return _batches[batchId];
    }

    /// @notice Whether a batch with this ID has been registered.
    function batchExists(uint256 batchId) external view override returns (bool) {
        return _batchExists(batchId);
    }

    /// @notice The number of batches registered so far.
    function totalBatches() external view override returns (uint256) {
        return _nextBatchId - 1;
    }

    function _batchExists(uint256 batchId) internal view returns (bool) {
        return batchId != 0 && batchId < _nextBatchId;
    }
}
