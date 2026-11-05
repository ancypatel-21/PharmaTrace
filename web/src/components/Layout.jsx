import { NavLink, Outlet } from "react-router-dom";
import { useWallet } from "../context/WalletContext.jsx";
import WalletStatus from "./WalletStatus.jsx";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/verify", label: "Verify" },
  { to: "/admin", label: "Admin", role: "ADMIN" },
  { to: "/manufacturer", label: "Manufacturer", role: "MANUFACTURER" },
  { to: "/custody", label: "Custody", role: ["DISTRIBUTOR", "CARRIER", "PHARMACY"] },
  { to: "/regulator", label: "Regulator", role: "REGULATOR" },
];

/** Shared page shell: header, nav, wallet widget, mock/network banners. */
export default function Layout() {
  const { config, error, roles } = useWallet();

  // Highlight the pages the connected wallet can actually use.
  const canUse = (role) => !role || [role].flat().some((r) => roles.includes(r));

  return (
    <div className="app">
      <header className="header">
        <div className="header-row">
          <NavLink to="/" className="brand">
            PharmaTrace
          </NavLink>
          <WalletStatus />
        </div>
        <nav className="nav">
          {NAV.map(({ to, label, end, role }) => (
            <NavLink key={to} to={to} end={end} className={canUse(role) ? "" : "nav-dim"}>
              {label}
            </NavLink>
          ))}
        </nav>
      </header>

      {config.mock && (
        <div className="banner banner-info">
          Mock mode: no deployed contract found in <code>web/src/contracts/</code>. Roles come from
          the default Hardhat accounts until <code>scripts/export-abi.js</code> (A7) runs.
        </div>
      )}
      {error && <div className="banner banner-error">{error}</div>}

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer muted">
        {config.networkName} (chain {config.chainId})
        {config.address && (
          <>
            {" · "}
            {config.explorer ? (
              <a href={`${config.explorer}/address/${config.address}`} target="_blank" rel="noreferrer">
                {config.address}
              </a>
            ) : (
              <code>{config.address}</code>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
