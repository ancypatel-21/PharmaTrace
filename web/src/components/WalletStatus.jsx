import { useWallet } from "../context/WalletContext.jsx";
import { shortAddress } from "../lib/format.js";
import { ROLE_LABELS } from "../lib/roles.js";
import RoleBadge from "./RoleBadge.jsx";

/** Header widget: connect button, or the connected address with its role badges. */
export default function WalletStatus() {
  const {
    walletInstalled,
    account,
    accounts,
    accountRoles,
    selectAccount,
    roles,
    rolesLoading,
    wrongNetwork,
    connect,
    switchAccount,
    disconnect,
    switchNetwork,
    config,
  } = useWallet();

  if (!account) {
    return (
      <button type="button" className="btn" onClick={connect} disabled={!walletInstalled}>
        {walletInstalled ? "Connect wallet" : "No wallet found"}
      </button>
    );
  }

  return (
    <div className="wallet-status">
      {accounts.length > 1 ? (
        <select
          className="account-select"
          aria-label="Act as account"
          value={accounts.find((a) => a.toLowerCase() === account.toLowerCase()) ?? account}
          onChange={(e) => selectAccount(e.target.value)}
        >
          {accounts.map((a) => {
            const found = accountRoles[a.toLowerCase()] ?? [];
            const label = found.length ? found.map((r) => ROLE_LABELS[r] ?? r).join(", ") : "No role";
            return (
              <option key={a} value={a}>
                {label} · {shortAddress(a)}
              </option>
            );
          })}
        </select>
      ) : (
        <span className="address" title={account}>
          {shortAddress(account)}
        </span>
      )}
      {rolesLoading ? (
        <span className="muted">checking role…</span>
      ) : roles.length ? (
        roles.map((r) => <RoleBadge key={r} role={r} />)
      ) : (
        <span className="badge role-none">No role</span>
      )}
      <button type="button" className="btn btn-ghost" onClick={switchAccount} title="Pick another MetaMask account">
        Switch account
      </button>
      <button type="button" className="btn btn-ghost" onClick={disconnect} title="Log out of this wallet">
        Disconnect
      </button>
      {wrongNetwork && (
        <button type="button" className="btn btn-warn" onClick={switchNetwork}>
          Switch to {config.networkName}
        </button>
      )}
    </div>
  );
}
