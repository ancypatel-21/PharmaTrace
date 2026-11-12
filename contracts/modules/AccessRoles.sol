// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IProvenanceTracker} from "../interfaces/IProvenanceTracker.sol";

/// @title AccessRoles
/// @notice Role-based access control for the six PharmaTrace participant roles, built on
///         OpenZeppelin AccessControl. The deploying account holds DEFAULT_ADMIN_ROLE and is
///         the only account that can register or revoke a participant.
/// @dev Abstract: only implements the registerParticipant / revokeParticipant slice of
///      IProvenanceTracker. Combined with the other modules in ProvenanceTracker.sol.
abstract contract AccessRoles is AccessControl, IProvenanceTracker {
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant CARRIER_ROLE = keccak256("CARRIER_ROLE");
    bytes32 public constant PHARMACY_ROLE = keccak256("PHARMACY_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    /// @notice `role` is not one of the six participant roles declared above.
    /// @dev DEFAULT_ADMIN_ROLE is deliberately not grantable or revocable through
    ///      registerParticipant / revokeParticipant, so it can never be handed out by mistake.
    error InvalidParticipantRole(bytes32 role);

    /// @notice `account` already holds `role`.
    error AlreadyRegistered(address account, bytes32 role);

    /// @notice `account` holds none of the six participant roles.
    error NotRegistered(address account);

    /// @notice The zero address cannot be registered or revoked.
    error ZeroAddress();

    mapping(address => string) private _participantNames;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Grants `role` to `account` and records a display name for it.
    /// @dev Admin only. Reverts with InvalidParticipantRole if `role` is not one of the six
    ///      participant role constants, and with AlreadyRegistered if `account` already holds
    ///      `role`. The stored name lets the UI show e.g. "CityCare Pharmacy" instead of a
    ///      raw address; it is not validated beyond being stored as given.
    function registerParticipant(address account, bytes32 role, string calldata name)
        external
        override
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (account == address(0)) revert ZeroAddress();
        if (!_isParticipantRole(role)) revert InvalidParticipantRole(role);
        if (hasRole(role, account)) revert AlreadyRegistered(account, role);

        _grantRole(role, account);
        _participantNames[account] = name;

        emit ParticipantRegistered(account, role, name);
    }

    /// @notice Revokes every participant role `account` holds and clears its display name.
    /// @dev Admin only. The interface takes no role argument, so this revokes all six
    ///      participant roles the account currently holds (an account is not expected to hold
    ///      more than one, but this is safe either way); DEFAULT_ADMIN_ROLE is untouched.
    ///      Reverts with NotRegistered if `account` holds none of the six participant roles.
    function revokeParticipant(address account) external override onlyRole(DEFAULT_ADMIN_ROLE) {
        bytes32[6] memory roles = [
            MANUFACTURER_ROLE,
            DISTRIBUTOR_ROLE,
            CARRIER_ROLE,
            PHARMACY_ROLE,
            REGULATOR_ROLE,
            ORACLE_ROLE
        ];

        bool revokedAny = false;
        for (uint256 i = 0; i < roles.length; i++) {
            if (hasRole(roles[i], account)) {
                _revokeRole(roles[i], account);
                revokedAny = true;
            }
        }

        if (!revokedAny) revert NotRegistered(account);

        delete _participantNames[account];
    }

    /// @notice The display name registered for `account`, or an empty string if none was set
    ///         or the participant was revoked.
    /// @param account The address to look up.
    /// @return name The stored display name.
    function participantName(address account) external view returns (string memory name) {
        return _participantNames[account];
    }

    function _isParticipantRole(bytes32 role) private pure returns (bool) {
        return role == MANUFACTURER_ROLE
            || role == DISTRIBUTOR_ROLE
            || role == CARRIER_ROLE
            || role == PHARMACY_ROLE
            || role == REGULATOR_ROLE
            || role == ORACLE_ROLE;
    }
}
