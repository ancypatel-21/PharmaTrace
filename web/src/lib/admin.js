// Admin helpers: the participant directory (reused from custody.js, which already builds it
// from ParticipantRegistered events) plus error decoding for AccessRoles' custom errors, which
// custody.js's error list does not cover.

import { Interface } from "ethers";

export { loadParticipantsSafely } from "./custody.js";

/** The six participant roles an admin can register someone into (excludes ADMIN itself). */
export const PARTICIPANT_ROLE_KEYS = [
  "MANUFACTURER",
  "DISTRIBUTOR",
  "CARRIER",
  "PHARMACY",
  "REGULATOR",
  "ORACLE",
];

const ERRORS = new Interface([
  "error InvalidParticipantRole(bytes32 role)",
  "error AlreadyRegistered(address account, bytes32 role)",
  "error NotRegistered(address account)",
  "error ZeroAddress()",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
]);

const ERROR_MESSAGES = {
  InvalidParticipantRole: "That is not one of the six participant roles.",
  AlreadyRegistered: "This address already holds that role.",
  NotRegistered: "This address holds no participant role.",
  ZeroAddress: "Enter a valid address.",
  AccessControlUnauthorizedAccount: "Your wallet doesn't have the admin role.",
};

function findRevertData(err) {
  for (const candidate of [err?.data, err?.error?.data, err?.info?.error?.data, err?.error?.data?.data]) {
    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length >= 10) {
      return candidate;
    }
  }
  return null;
}

/** Turns a failed registerParticipant / revokeParticipant call into a sentence an admin can act on. */
export function adminErrorMessage(err) {
  if (err?.code === "ACTION_REJECTED" || err?.code === 4001 || err?.info?.error?.code === 4001) {
    return "Transaction rejected in the wallet.";
  }

  let name = err?.revert?.name;
  if (!name) {
    const data = findRevertData(err);
    if (data) {
      try {
        name = ERRORS.parseError(data)?.name;
      } catch {
        // Not one of ours; fall through to the generic message.
      }
    }
  }
  if (name && ERROR_MESSAGES[name]) return ERROR_MESSAGES[name];

  return err?.shortMessage ?? err?.reason ?? err?.message ?? "Transaction failed.";
}
