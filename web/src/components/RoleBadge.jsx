import { ROLE_LABELS } from "../lib/roles.js";

/** Pill for a role key such as "MANUFACTURER". */
export default function RoleBadge({ role }) {
  return <span className={`badge role-${role.toLowerCase()}`}>{ROLE_LABELS[role] ?? role}</span>;
}
