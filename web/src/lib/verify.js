// Data for the public verify page (V3). Read-only: every value comes from a view function or an
// event log through the read-only provider, so no wallet is needed. See docs/ui-data.md.

import { STATUS, isInColdChainRange } from "./format.js";

/** "12" -> 12n. Anything that is not a positive whole number -> null. */
export function parseBatchId(raw) {
  const s = String(raw ?? "").trim();
  if (!/^[1-9]\d{0,76}$/.test(s)) return null;
  return BigInt(s);
}

// Events the page lists, all indexed by batchId as their first topic.
export const VERIFY_EVENTS = [
  "BatchApproved",
  "StatusChanged",
  "TemperatureReported",
  "TemperatureExcursion",
  "BatchQuarantined",
  "QuarantineReleased",
  "BatchRecalled",
];

/**
 * Turns parsed logs (any order) into activity entries, oldest first. Custody handoffs are left
 * to <CustodyTimeline>; StatusChanged is kept only for Stored and Dispensed, the two status
 * changes no other event already describes.
 *
 * @param {Array<{ name: string, args: any, blockNumber: number, index: number, timestamp?: number }>} logs
 */
export function buildActivity(logs) {
  const sorted = [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  const entries = [];
  for (const log of sorted) {
    const { name, args } = log;
    const base = { blockNumber: log.blockNumber, timestamp: log.timestamp };
    switch (name) {
      case "BatchApproved":
        entries.push({ ...base, kind: "approved", actor: args.approvedBy, hash: args.certificateHash });
        break;
      case "StatusChanged":
        if (Number(args.to) === STATUS.Stored || Number(args.to) === STATUS.Dispensed) {
          entries.push({ ...base, kind: "status", status: Number(args.to), actor: args.actor });
        }
        break;
      case "TemperatureReported":
        entries.push({
          ...base,
          kind: "temperature",
          min: Number(args.minTenthsC),
          max: Number(args.maxTenthsC),
          count: Number(args.readingCount),
          inRange: isInColdChainRange(args.minTenthsC, args.maxTenthsC),
        });
        break;
      case "TemperatureExcursion":
        entries.push({ ...base, kind: "excursion", min: Number(args.minTenthsC), max: Number(args.maxTenthsC) });
        break;
      case "BatchQuarantined":
        entries.push({ ...base, kind: "quarantined", reason: args.reason });
        break;
      case "QuarantineReleased":
        entries.push({ ...base, kind: "released", status: Number(args.restoredStatus) });
        break;
      case "BatchRecalled":
        entries.push({ ...base, kind: "recalled", reason: args.reason });
        break;
      default:
        break;
    }
  }
  return entries;
}

/** Reason from the most recent entry of `kind` ("quarantined" or "recalled"), or null. */
export function latestReason(activity, kind) {
  for (let i = activity.length - 1; i >= 0; i -= 1) {
    if (activity[i].kind === kind) return activity[i].reason || null;
  }
  return null;
}

/**
 * Warnings shown at the top of the page, most serious first.
 * level: "danger" (red banner) or "warn" (amber notice).
 */
export function verificationWarnings({ batch, activity = [], nowSeconds = Math.floor(Date.now() / 1000) }) {
  const warnings = [];
  const status = Number(batch.status);
  if (status === STATUS.Recalled) {
    warnings.push({
      level: "danger",
      title: "Recalled: do not use this medicine",
      detail: latestReason(activity, "recalled"),
    });
  } else if (status === STATUS.Quarantined) {
    warnings.push({
      level: "danger",
      title: "Quarantined: this batch is on hold",
      detail: latestReason(activity, "quarantined"),
    });
  }
  if (Number(batch.expiryDate) && Number(batch.expiryDate) <= nowSeconds) {
    warnings.push({ level: "warn", title: "Expired", detail: "The expiry date has passed." });
  }
  if (!batch.approved) {
    warnings.push({ level: "warn", title: "Not approved by a regulator yet", detail: null });
  }
  return warnings;
}

/** Whether the latest temperature summary exists and is inside 2-8 °C. */
export function temperatureState(summary) {
  if (!summary || !Number(summary.reportedAt)) return { reported: false, inRange: null };
  return { reported: true, inRange: isInColdChainRange(summary.minTenthsC, summary.maxTenthsC) };
}

/**
 * Reads this batch's events in one eth_getLogs call and attaches block timestamps.
 * Throws on RPC failure; callers treat events as optional.
 */
export async function loadBatchEvents(contract, batchId, fromBlock = 0) {
  const iface = contract.interface;
  const provider = contract.runner?.provider ?? contract.runner;
  const topics = [
    VERIFY_EVENTS.map((name) => iface.getEvent(name).topicHash),
    iface.getAbiCoder().encode(["uint256"], [batchId]),
  ];
  const raw = await provider.getLogs({ address: await contract.getAddress(), topics, fromBlock });

  const blocks = new Map();
  await Promise.all(
    [...new Set(raw.map((l) => l.blockNumber))].map(async (n) => {
      const block = await provider.getBlock(n);
      blocks.set(n, block?.timestamp);
    }),
  );

  return raw.map((log) => {
    const parsed = iface.parseLog(log);
    return {
      name: parsed.name,
      args: parsed.args,
      blockNumber: log.blockNumber,
      index: log.index,
      timestamp: blocks.get(log.blockNumber),
    };
  });
}

/**
 * Everything the verify page shows except the custody timeline (N6 loads that itself).
 *
 * @returns {Promise<{ exists: false } | { exists: true, batch, temperature, reportCount,
 *   approvedBy, activity, eventsError }>}
 */
export async function loadVerification(contract, batchId, { fromBlock = 0 } = {}) {
  const summary = await contract.getBatchSummary(batchId);
  if (!summary.exists) return { exists: false };

  let activity = [];
  let eventsError = null;
  try {
    activity = buildActivity(await loadBatchEvents(contract, batchId, fromBlock));
  } catch (err) {
    eventsError = err?.shortMessage ?? err?.message ?? "Event history unavailable.";
  }

  return {
    exists: true,
    batch: summary.batch,
    temperature: summary.latestTemperature,
    reportCount: Number(summary.temperatureReportCount),
    approvedBy: summary.approvedBy,
    activity,
    eventsError,
  };
}
