// Regulator dashboard helpers (S6). The rules live in contracts/modules/StatusModule.sol
// (S3 quarantine/release/recall, S4 approval); these helpers only decide what to show and which
// buttons to offer. The contract still checks every transaction.

import { Interface, isHexString, keccak256 } from "ethers";
import { STATUS } from "./format.js";
import { custodyErrorMessage } from "./custody.js";

// Contract-wide events the dashboard reads to explain why a batch needs attention.
export const REGULATOR_EVENTS = [
  "TemperatureExcursion",
  "BatchQuarantined",
  "QuarantineReleased",
  "BatchRecalled",
];

const TERMINAL = new Set([STATUS.Dispensed, STATUS.Recalled]);

/**
 * Per-batch facts from parsed logs (any order): excursion count and latest reading, the latest
 * quarantine reason and the recall reason.
 *
 * @param {Array<{ name: string, args: any, blockNumber: number, index: number }>} logs
 * @returns {Map<string, { excursions: number, lastExcursion: { min: number, max: number } | null,
 *   quarantineReason: string | null, recallReason: string | null }>} keyed by batch ID string
 */
export function buildRegulatorIndex(logs) {
  const sorted = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  const index = new Map();
  const entry = (id) => {
    const key = String(id);
    if (!index.has(key)) {
      index.set(key, { excursions: 0, lastExcursion: null, quarantineReason: null, recallReason: null });
    }
    return index.get(key);
  };

  for (const { name, args } of sorted) {
    const e = entry(args.batchId);
    switch (name) {
      case "TemperatureExcursion":
        e.excursions += 1;
        e.lastExcursion = { min: Number(args.minTenthsC), max: Number(args.maxTenthsC) };
        break;
      case "BatchQuarantined":
        e.quarantineReason = args.reason || null;
        break;
      case "QuarantineReleased":
        e.quarantineReason = null;
        break;
      case "BatchRecalled":
        e.recallReason = args.reason || null;
        break;
      default:
        break;
    }
  }
  return index;
}

/** Facts for one batch, with empty defaults when the batch has no events. */
export function batchFacts(index, batchId) {
  return (
    index?.get(String(batchId)) ?? {
      excursions: 0,
      lastExcursion: null,
      quarantineReason: null,
      recallReason: null,
    }
  );
}

/** Still in Created and not approved: blocked from its first shipment (S4). */
export function needsApproval(batch) {
  return Number(batch.status) === STATUS.Created && !batch.approved;
}

/** Quarantined, waiting for approval, or had a temperature excursion while still active. */
export function needsAttention(batch, facts) {
  const status = Number(batch.status);
  if (status === STATUS.Quarantined) return true;
  if (needsApproval(batch)) return true;
  return facts.excursions > 0 && !TERMINAL.has(status);
}

/**
 * Which regulator actions make sense for a batch right now. Mirrors the contract:
 *   approve:    not yet approved and not Quarantined/Recalled/Dispensed (BatchFrozen)
 *   quarantine: any non-terminal status that is not already Quarantined
 *   release:    only while Quarantined
 *   recall:     any non-terminal status (goes via Quarantined)
 */
export function regulatorActions(batch) {
  const status = Number(batch.status);
  const terminal = TERMINAL.has(status);
  const quarantined = status === STATUS.Quarantined;
  return {
    approve: !batch.approved && !terminal && !quarantined,
    quarantine: !terminal && !quarantined,
    release: quarantined,
    recall: !terminal,
  };
}

// Filter options for the status dropdown. "attention" is the default view.
export const FILTERS = [
  { value: "attention", label: "Needs attention" },
  { value: "all", label: "All batches" },
  { value: "approval", label: "Waiting for approval" },
  { value: "excursion", label: "Had a temperature excursion" },
  ...Object.entries(STATUS).map(([label, value]) => ({
    value: `status-${value}`,
    label: label === "InTransit" ? "In transit" : label,
  })),
];

/** Batches matching a filter value from FILTERS. */
export function filterBatches(batches, filter, index) {
  return batches.filter((b) => {
    const facts = batchFacts(index, b.id);
    if (filter === "all") return true;
    if (filter === "attention") return needsAttention(b, facts);
    if (filter === "approval") return needsApproval(b);
    if (filter === "excursion") return facts.excursions > 0;
    if (filter.startsWith("status-")) return Number(b.status) === Number(filter.slice(7));
    return true;
  });
}

/** Most urgent first: Quarantined, then waiting for approval, then excursions, then by ID. */
export function sortForReview(batches, index) {
  const rank = (b) => {
    const facts = batchFacts(index, b.id);
    if (Number(b.status) === STATUS.Quarantined) return 0;
    if (needsApproval(b)) return 1;
    if (facts.excursions > 0 && !TERMINAL.has(Number(b.status))) return 2;
    return 3;
  };
  return [...batches].sort((a, b) => rank(a) - rank(b) || Number(a.id) - Number(b.id));
}

/** Counts for the summary row. */
export function dashboardCounts(batches, index) {
  const counts = { total: batches.length, approval: 0, quarantined: 0, excursion: 0, recalled: 0 };
  for (const b of batches) {
    const status = Number(b.status);
    if (needsApproval(b)) counts.approval += 1;
    if (status === STATUS.Quarantined) counts.quarantined += 1;
    if (status === STATUS.Recalled) counts.recalled += 1;
    if (batchFacts(index, b.id).excursions > 0) counts.excursion += 1;
  }
  return counts;
}

/**
 * A certificate hash typed or pasted by the regulator: 0x followed by 64 hex characters.
 * Returns the lower-case hash, or null if it is not one (or is all zeros, which the contract
 * rejects with EmptyCertificateHash).
 */
export function parseCertificateHash(raw) {
  const s = String(raw ?? "").trim();
  if (!isHexString(s, 32)) return null;
  const hash = s.toLowerCase();
  return /^0x0{64}$/.test(hash) ? null : hash;
}

/** keccak256 of a certificate file's bytes, computed in the browser (nothing is uploaded). */
export function hashCertificateBytes(bytes) {
  return keccak256(bytes);
}

/** Trimmed reason, or null if empty (the contract rejects empty reasons with EmptyReason). */
export function cleanReason(raw) {
  const s = String(raw ?? "").trim();
  return s.length ? s : null;
}

// Errors from the regulator functions that custody.js does not already explain.
const ERRORS = new Interface([
  "error EmptyReason()",
  "error NotQuarantined(uint256 batchId, uint8 status)",
  "error RecallNotAuthorized(uint256 batchId, address caller)",
  "error AlreadyApproved(uint256 batchId, address approvedBy)",
  "error EmptyCertificateHash()",
  "error BatchFrozen(uint256 batchId, uint8 status)",
]);

const ERROR_MESSAGES = {
  EmptyReason: "Enter a reason: it is recorded on-chain and shown on the verify page.",
  NotQuarantined: "This batch is not quarantined, so there is nothing to release.",
  RecallNotAuthorized: "Only a Regulator or the batch's own Manufacturer can recall it.",
  AlreadyApproved: "This batch has already been approved.",
  EmptyCertificateHash: "Enter the certificate hash, or choose the certificate file to hash it.",
  BatchFrozen: "A quarantined, recalled or dispensed batch can't be approved.",
};

function findRevertData(err) {
  for (const candidate of [err?.data, err?.error?.data, err?.info?.error?.data, err?.error?.data?.data]) {
    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length >= 10) {
      return candidate;
    }
  }
  return null;
}

/** Turns a failed regulator transaction into a sentence the regulator can act on. */
export function regulatorErrorMessage(err) {
  let name = err?.revert?.name;
  if (!name) {
    const data = findRevertData(err);
    if (data) {
      try {
        name = ERRORS.parseError(data)?.name;
      } catch {
        // Not one of ours; custody.js knows the shared errors.
      }
    }
  }
  if (name && ERROR_MESSAGES[name]) return ERROR_MESSAGES[name];
  return custodyErrorMessage(err);
}

/**
 * Reads the dashboard's events across all batches in one eth_getLogs call.
 * Throws on RPC failure; the page treats events as optional.
 */
export async function loadRegulatorEvents(contract, fromBlock = 0) {
  const iface = contract.interface;
  const provider = contract.runner?.provider ?? contract.runner;
  const topics = [REGULATOR_EVENTS.map((name) => iface.getEvent(name).topicHash)];
  const raw = await provider.getLogs({ address: await contract.getAddress(), topics, fromBlock });
  return raw.map((log) => {
    const parsed = iface.parseLog(log);
    return { name: parsed.name, args: parsed.args, blockNumber: log.blockNumber, index: log.index };
  });
}
