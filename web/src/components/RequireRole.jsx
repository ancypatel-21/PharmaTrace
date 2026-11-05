import { useWallet } from "../context/WalletContext.jsx";
import { ROLE_LABELS } from "../lib/roles.js";
import RoleBadge from "./RoleBadge.jsx";

/**
 * Renders children only when the connected wallet holds one of `roles`; otherwise shows a
 * clear message (not connected / missing role). Role pages wrap their content in this.
 *
 *   <RequireRole roles={["MANUFACTURER"]}>...</RequireRole>
 */
export default function RequireRole({ roles, children }) {
  const { account, roles: held, rolesLoading, connect, walletInstalled } = useWallet();
  const needed = roles.map((r) => ROLE_LABELS[r] ?? r).join(" or ");

  if (!account) {
    return (
      <div className="notice">
        <p>This page needs a wallet with the {needed} role.</p>
        <button type="button" className="btn" onClick={connect} disabled={!walletInstalled}>
          Connect wallet
        </button>
      </div>
    );
  }

  if (rolesLoading) return <p className="muted">Checking your role…</p>;

  if (!roles.some((r) => held.includes(r))) {
    return (
      <div className="notice notice-error">
        <p>
          This page needs the <strong>{needed}</strong> role. The connected wallet has{" "}
          {held.length ? held.map((r) => <RoleBadge key={r} role={r} />) : "no role"}.
        </p>
        <p className="muted">Ask the admin to register this address, or switch account in MetaMask.</p>
      </div>
    );
  }

  return children;
}
