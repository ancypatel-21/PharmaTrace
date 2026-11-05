// Role identifiers and role detection.
//
// AccessRoles (A4) uses OpenZeppelin AccessControl, where each role is
// keccak256("<NAME>_ROLE") and the admin is DEFAULT_ADMIN_ROLE = 0x00. registerParticipant
// takes the role as bytes32, so the UI computes the same values locally.

import { Contract, ZeroHash, id } from "ethers";

export const ROLES = {
  ADMIN: ZeroHash,
  MANUFACTURER: id("MANUFACTURER_ROLE"),
  DISTRIBUTOR: id("DISTRIBUTOR_ROLE"),
  CARRIER: id("CARRIER_ROLE"),
  PHARMACY: id("PHARMACY_ROLE"),
  REGULATOR: id("REGULATOR_ROLE"),
  ORACLE: id("ORACLE_ROLE"),
};

export const ROLE_LABELS = {
  ADMIN: "Admin",
  MANUFACTURER: "Manufacturer",
  DISTRIBUTOR: "Distributor",
  CARRIER: "Carrier",
  PHARMACY: "Pharmacy",
  REGULATOR: "Regulator",
  ORACLE: "Oracle",
};

/** Maps a bytes32 role value (e.g. from ParticipantRegistered) back to its key, or null. */
export function roleKeyFromHash(hash) {
  const lower = String(hash).toLowerCase();
  return Object.keys(ROLES).find((k) => ROLES[k].toLowerCase() === lower) ?? null;
}

// AccessControl.hasRole is inherited from OpenZeppelin, so it is not declared in
// IProvenanceTracker.sol. Added here so role checks work with the interface-only mock ABI.
export const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

// Mock mode only (no deployed contract yet): the default Hardhat node accounts #0-#6, one per
// role. Replaced by real hasRole calls once A7 exports a deployment.
export const MOCK_ROLE_ACCOUNTS = {
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266": ["ADMIN"],
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": ["MANUFACTURER"],
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": ["DISTRIBUTOR"],
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906": ["CARRIER"],
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65": ["PHARMACY"],
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc": ["REGULATOR"],
  "0x976ea74026e726554db657fa54763abd0c3a0aa9": ["ORACLE"],
};

/**
 * Returns the role keys held by an account, e.g. ["MANUFACTURER"].
 *
 * @param {{ config: object, account: string, provider?: import("ethers").Provider }} args
 */
export async function detectRoles({ config, account, provider }) {
  if (!account) return [];
  if (config.mock) return MOCK_ROLE_ACCOUNTS[account.toLowerCase()] ?? [];

  const contract = new Contract(config.address, ACCESS_CONTROL_ABI, provider);
  const keys = Object.keys(ROLES);
  const results = await Promise.all(keys.map((k) => contract.hasRole(ROLES[k], account)));
  return keys.filter((_, i) => results[i]);
}
