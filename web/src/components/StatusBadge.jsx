import { STATUS_LABELS, statusLabel } from "../lib/format.js";

/** Coloured pill for a batch Status value (number or bigint). */
export default function StatusBadge({ status }) {
  const key = STATUS_LABELS[Number(status)] ?? "Unknown";
  return <span className={`badge status-${key.toLowerCase()}`}>{statusLabel(status)}</span>;
}
