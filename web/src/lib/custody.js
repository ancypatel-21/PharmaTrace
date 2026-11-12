// Custody helpers shared by the custody page (N5) and the custody timeline (N6).
//
// The contract rules live in contracts/modules/CustodyModule.sol; the hop table below mirrors
// it so the UI only offers recipients the contract will accept. The contract still checks
// every transaction, so a stale list here can only cause a clear revert, never a bad handoff.

import { Contract, Interface } from "ethers";
import { ACCESS_CONTROL_ABI, ROLES, roleKeyFromHash } from "./roles.js";
import { STATUS } from "./format.js";

/** Sender role -> recipient roles it may hand a batch to (CustodyModule hop table). */
export const HOPS = {
  MANUFACTURER: ["DISTRIBUTOR", "CARRIER"],
  DISTRIBUTOR: ["CARRIER", "PHARMACY"],
  CARRIER: ["DISTRIBUTOR", "PHARMACY"],
  PHARMACY: [],
};

/** Roles that can hold a batch and therefore use the custody page. */
export const CUSTODY_ROLES = Object.keys(HOPS);

/** Recipient roles reachable from any of `senderRoles` (an account may hold several). */
export function nextHopRoles(senderRoles) {
  return [...new Set(senderRoles.flatMap((r) => HOPS[r] ?? []))];
}

/** Statuses a batch can be sent from (Created -> InTransit, Received/Stored -> next hop). */
export function canSendFrom(status) {
  const s = Number(status);
  return s === STATUS.Created || s === STATUS.Received || s === STATUS.Stored;
}

const lower = (address) => String(address).toLowerCase();

/**
 * Builds the participant directory from ParticipantRegistered events, oldest first.
 * The latest name registered for an address wins.
 *
 * @param {Array<{ args: { account: string, role: string, name: string } }>} events
 * @returns {Map<string, { address: string, name: string, roles: string[] }>} keyed by lowercase address
 */
export function buildDirectory(events) {
  const directory = new Map();
  for (const { args } of events) {
    const key = lower(args.account);
    const entry = directory.get(key) ?? { address: args.account, name: "", roles: [] };
    const roleKey = roleKeyFromHash(args.role);
    if (roleKey && !entry.roles.includes(roleKey)) entry.roles.push(roleKey);
    if (args.name) entry.name = args.name;
    directory.set(key, entry);
  }
  return directory;
}

/**
 * Loads every registered participant with the roles it holds right now (revocations emit no
 * event, so each role from the events is re-checked with hasRole).
 */
export async function loadParticipants(contract) {
  const events = await contract.queryFilter(contract.filters.ParticipantRegistered());
  const directory = buildDirectory(events);

  const access = new Contract(await contract.getAddress(), ACCESS_CONTROL_ABI, contract.runner);
  await Promise.all(
    [...directory.values()].map(async (entry) => {
      const held = await Promise.all(entry.roles.map((r) => access.hasRole(ROLES[r], entry.address)));
      entry.roles = entry.roles.filter((_, i) => held[i]);
    }),
  );
  return directory;
}

/**
 * loadParticipants that never throws. Names are a convenience: if the event query fails (some
 * public RPCs refuse large log ranges), pages keep working with plain addresses.
 *
 * @returns {Promise<{ directory: Map, error: string | null }>}
 */
export async function loadParticipantsSafely(contract) {
  try {
    return { directory: await loadParticipants(contract), error: null };
  } catch (err) {
    return { directory: new Map(), error: custodyErrorMessage(err) };
  }
}

/** Display name for an address from the directory, falling back to null. */
export function participantName(directory, address) {
  return directory?.get(lower(address))?.name || null;
}

/** Participants the sender may hand a batch to: allowed role, not the sender itself. */
export function eligibleRecipients(directory, senderRoles, senderAddress) {
  const allowed = nextHopRoles(senderRoles);
  return [...directory.values()].filter(
    (p) => lower(p.address) !== lower(senderAddress) && p.roles.some((r) => allowed.includes(r)),
  );
}

/** Reads every registered batch (IDs 1..totalBatches). Fine for a course-sized deployment. */
export async function loadBatches(contract) {
  const total = Number(await contract.totalBatches());
  const ids = Array.from({ length: total }, (_, i) => i + 1);
  return Promise.all(ids.map((id) => contract.getBatch(id)));
}

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Splits batches into what the connected account can act on:
 *   incoming: transfers waiting for this account to accept
 *   held:     batches this account is the current custodian of (including outgoing ones)
 */
export function classifyBatches(batches, account) {
  const me = lower(account);
  return {
    incoming: batches.filter((b) => lower(b.pendingCustodian) === me),
    held: batches.filter((b) => lower(b.currentCustodian) === me),
  };
}

/** Whether a batch has a handoff waiting to be accepted. */
export function hasPendingTransfer(batch) {
  return lower(batch.pendingCustodian) !== ZERO;
}

/**
 * Timeline entries for one batch, oldest first:
 *   registered (manufacturer, createdAt), one handoff per CustodyRecord, then the pending
 *   handoff if one is waiting to be accepted.
 */
export function buildTimeline(batch, history) {
  const entries = [
    { kind: "registered", to: batch.manufacturer, timestamp: batch.createdAt, status: STATUS.Created },
  ];
  for (const record of history) {
    entries.push({
      kind: "handoff",
      from: record.from,
      to: record.to,
      timestamp: record.timestamp,
      status: record.statusAfter,
    });
  }
  if (hasPendingTransfer(batch)) {
    entries.push({ kind: "pending", from: batch.currentCustodian, to: batch.pendingCustodian });
  }
  return entries;
}

// Errors the custody and status functions can revert with. Declared here too because the mock
// ABI (interface only) does not include the module-level errors, and wallets sometimes return
// raw revert data that ethers has not decoded.
const ERRORS = new Interface([
  "error NotCurrentCustodian(uint256 batchId, address caller)",
  "error InvalidNextHop(uint256 batchId, address to)",
  "error TransferAlreadyPending(uint256 batchId, address pendingCustodian)",
  "error NoPendingTransfer(uint256 batchId)",
  "error NotPendingCustodian(uint256 batchId, address caller)",
  "error UnknownBatch(uint256 batchId)",
  "error InvalidTransition(uint256 batchId, uint8 from, uint8 to)",
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
]);

const ERROR_MESSAGES = {
  NotCurrentCustodian: "You are not the current custodian of this batch.",
  InvalidNextHop:
    "That recipient can't take this batch: they need a role your role may hand off to, and can't be you.",
  TransferAlreadyPending: "This batch already has a transfer waiting to be accepted.",
  NoPendingTransfer: "There is no transfer waiting for this batch.",
  NotPendingCustodian: "This transfer is addressed to another account.",
  UnknownBatch: "No batch has this ID.",
  InvalidTransition:
    "The batch's status doesn't allow this right now (it may be quarantined, recalled or dispensed).",
  AccessControlUnauthorizedAccount: "Your wallet doesn't have the role this action needs.",
};

function findRevertData(err) {
  for (const candidate of [err?.data, err?.error?.data, err?.info?.error?.data, err?.error?.data?.data]) {
    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length >= 10) {
      return candidate;
    }
  }
  return null;
}

/** Turns a failed transaction or call into a sentence a participant can act on. */
export function custodyErrorMessage(err) {
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
