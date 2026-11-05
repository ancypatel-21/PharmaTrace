// Display helpers shared by every page. Rules follow docs/ui-data.md.

// Same order as `enum Status` in contracts/PharmaTypes.sol.
export const STATUS_LABELS = [
  "Created",
  "InTransit",
  "Received",
  "Stored",
  "Dispensed",
  "Quarantined",
  "Recalled",
];

export const STATUS = Object.fromEntries(STATUS_LABELS.map((label, i) => [label, i]));

/** Human label for a Status value (number or bigint from ethers). */
export function statusLabel(status) {
  const label = STATUS_LABELS[Number(status)];
  if (!label) return "Unknown";
  return label === "InTransit" ? "In transit" : label;
}

/** "0x1234…abcd" */
export function shortAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Tenths of a degree Celsius (80) -> "8.0 °C". */
export function formatTenthsC(tenths) {
  return `${(Number(tenths) / 10).toFixed(1)} °C`;
}

/** Cold-chain range check: 2.0-8.0 °C inclusive, in tenths. */
export function isInColdChainRange(minTenthsC, maxTenthsC) {
  return Number(minTenthsC) >= 20 && Number(maxTenthsC) <= 80;
}

/** Unix seconds (number or bigint) -> locale date/time string, or "" for 0. */
export function formatTimestamp(seconds) {
  const n = Number(seconds);
  if (!n) return "";
  return new Date(n * 1000).toLocaleString();
}

/** Unix seconds -> locale date string, or "" for 0. */
export function formatDate(seconds) {
  const n = Number(seconds);
  if (!n) return "";
  return new Date(n * 1000).toLocaleDateString();
}
