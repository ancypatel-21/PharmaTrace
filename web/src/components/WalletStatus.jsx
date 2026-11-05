import { useWallet } from "../context/WalletContext.jsx";
import { shortAddress } from "../lib/format.js";
import RoleBadge from "./RoleBadge.jsx";

/** Header widget: connect button, or the connected address with its role badges. */
export default function WalletStatus() {
  const { walletInstalled, account, roles, rolesLoading, wrongNetwork, connect, switchNetwork, config } =
    useWallet();

  if (!account) {
    return (
      <button type="button" className="btn" onClick={connect} disabled={!walletInstalled}>
        {walletInstalled ? "Connect wallet" : "No wallet found"}
      </button>
    );
  }

  return (
    <div className="wallet-status">
      <span className="address" title={account}>
        {shortAddress(account)}
      </span>
      {rolesLoading ? (
        <span className="muted">checking role…</span>
      ) : roles.length ? (
        roles.map((r) => <RoleBadge key={r} role={r} />)
      ) : (
        <span className="badge role-none">No role</span>
      )}
      {wrongNetwork && (
        <button type="button" className="btn btn-warn" onClick={switchNetwork}>
          Switch to {config.networkName}
        </button>
      )}
    </div>
  );
}
