// Summarises one window of raw temperature readings into the arguments the Oracle role
// reports on-chain via reportTemperature (see IProvenanceTracker.sol, B1).
//
// Temperatures are integer tenths of a degree Celsius (2.0 C = 20, 8.0 C = 80) so they fit
// the contract's int16 fields. Raw readings never go on-chain: readingsHash is the keccak256
// of the exact raw-readings JSON string, which is also what gets written to simulator/data/,
// so anyone holding that file can recompute the hash and compare it with the chain.

const { keccak256, toUtf8Bytes } = require("ethers");

// Cold-chain range, inclusive. Mirrors the contract: min < 20 or max > 80 is an excursion.
const MIN_TENTHS_C = 20;
const MAX_TENTHS_C = 80;

const INT16_MIN = -32768;
const INT16_MAX = 32767;
const UINT32_MAX = 4294967295;

function assertReadings(readings) {
  if (!Array.isArray(readings) || readings.length === 0) {
    throw new Error("readings must be a non-empty array");
  }
  if (readings.length > UINT32_MAX) {
    throw new Error("too many readings for a uint32 readingCount");
  }
  readings.forEach((r, i) => {
    if (
      !Number.isInteger(r.tenthsC) ||
      r.tenthsC < INT16_MIN ||
      r.tenthsC > INT16_MAX
    ) {
      throw new Error(
        `reading ${i}: tenthsC must be an int16 integer, got ${r.tenthsC}`,
      );
    }
    if (!Number.isInteger(r.timestamp) || r.timestamp < 0) {
      throw new Error(
        `reading ${i}: timestamp must be a non-negative integer (unix seconds)`,
      );
    }
    if (i > 0 && r.timestamp < readings[i - 1].timestamp) {
      throw new Error(`reading ${i}: timestamps must not go backwards`);
    }
  });
}

/**
 * Serialises a raw-readings object to the canonical JSON string that is both written to disk
 * and hashed. Compact, no trailing newline, so the file bytes equal the hashed bytes.
 */
function serializeReadings(raw) {
  return JSON.stringify(raw);
}

/** keccak256 of the raw-readings JSON string, as the 0x-prefixed bytes32 hex the contract expects. */
function hashReadings(readingsJson) {
  return keccak256(toUtf8Bytes(readingsJson));
}

/**
 * Reduces readings to { minTenthsC, maxTenthsC, avgTenthsC, readingCount, windowStart, windowEnd }.
 * avgTenthsC is for display and logs only; the contract has no average field.
 */
function summarize(readings) {
  assertReadings(readings);

  let min = readings[0].tenthsC;
  let max = readings[0].tenthsC;
  let sum = 0;
  for (const { tenthsC } of readings) {
    if (tenthsC < min) min = tenthsC;
    if (tenthsC > max) max = tenthsC;
    sum += tenthsC;
  }

  return {
    minTenthsC: min,
    maxTenthsC: max,
    avgTenthsC: Math.round((sum / readings.length) * 10) / 10,
    readingCount: readings.length,
    windowStart: readings[0].timestamp,
    windowEnd: readings[readings.length - 1].timestamp,
  };
}

/** True when the summary falls outside the 2-8 C range, i.e. the contract would quarantine. */
function isExcursion(summary) {
  return summary.minTenthsC < MIN_TENTHS_C || summary.maxTenthsC > MAX_TENTHS_C;
}

/**
 * Summarises a raw-readings object ({ batchId, scenario, readings, ... }) and hashes it.
 * Returns the summary, the JSON string to write to simulator/data/, and its readingsHash.
 */
function summarizeWindow(raw) {
  const summary = summarize(raw.readings);
  const readingsJson = serializeReadings(raw);
  return { summary, readingsJson, readingsHash: hashReadings(readingsJson) };
}

/** Positional arguments for reportTemperature, in the order declared in IProvenanceTracker. */
function toReportArgs(batchId, summary, readingsHash) {
  return [
    batchId,
    summary.minTenthsC,
    summary.maxTenthsC,
    summary.readingCount,
    summary.windowStart,
    summary.windowEnd,
    readingsHash,
  ];
}

module.exports = {
  MIN_TENTHS_C,
  MAX_TENTHS_C,
  serializeReadings,
  hashReadings,
  summarize,
  isExcursion,
  summarizeWindow,
  toReportArgs,
};
