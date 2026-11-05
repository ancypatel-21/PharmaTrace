import { Link } from "react-router-dom";
import BatchLookup from "../components/BatchLookup.jsx";
import RoleBadge from "../components/RoleBadge.jsx";
import { useWallet } from "../context/WalletContext.jsx";

const ROLE_PAGES = {
  ADMIN: { to: "/admin", label: "Manage participants" },
  MANUFACTURER: { to: "/manufacturer", label: "Register batches" },
  DISTRIBUTOR: { to: "/custody", label: "Custody actions" },
  CARRIER: { to: "/custody", label: "Custody actions" },
  PHARMACY: { to: "/custody", label: "Custody actions" },
  REGULATOR: { to: "/regulator", label: "Regulator dashboard" },
};

export default function Home() {
  const { account, roles, rolesLoading, walletInstalled, connect } = useWallet();

  return (
    <>
      <section className="card">
        <h1>Check a medicine batch</h1>
        <p className="muted">
          Enter the batch ID from the pack, or scan its QR code. No wallet needed.
        </p>
        <BatchLookup />
      </section>

      <section className="card">
        <h2>Supply chain participants</h2>
        {!account ? (
          <>
            <p className="muted">Connect your wallet to see your role and the pages you can use.</p>
            <button type="button" className="btn" onClick={connect} disabled={!walletInstalled}>
              {walletInstalled ? "Connect wallet" : "Install MetaMask to connect"}
            </button>
          </>
        ) : rolesLoading ? (
          <p className="muted">Checking your role…</p>
        ) : roles.length ? (
          <>
            <p data-testid="detected-roles">
              Connected as {roles.map((r) => <RoleBadge key={r} role={r} />)}
            </p>
            <ul className="links">
              {roles
                .filter((r) => ROLE_PAGES[r])
                .map((r) => (
                  <li key={r}>
                    <Link to={ROLE_PAGES[r].to}>{ROLE_PAGES[r].label}</Link>
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <p data-testid="detected-roles">
            This wallet has no participant role. You can still verify batches.
          </p>
        )}
      </section>
    </>
  );
}
