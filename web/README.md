# PharmaTrace web app

Vite + React + ethers v6. Role pages for participants (MetaMask) and a public verify page that
needs no wallet.

```bash
cd web
npm install
cp .env.example .env.local   # optional: VITE_NETWORK=localhost | amoy
npm run dev                  # http://localhost:5173 (also reachable from a phone on the LAN)
npm test                     # unit tests (vitest)
```

Until `scripts/export-abi.js` (A7) writes a deployment into `src/contracts/`, the app runs in
**mock mode** on the ABI compiled from `IProvenanceTracker.sol` (see
[`src/contracts/README.md`](src/contracts/README.md)). To try a role locally, import a default
Hardhat account into MetaMask: #0 Admin, #1 Manufacturer, #2 Distributor, #3 Carrier,
#4 Pharmacy, #5 Regulator, #6 Oracle.

## Layout

| Path | What | Owner |
| --- | --- | --- |
| `src/lib/config.js` | Loads address + ABI for `VITE_NETWORK`, mock fallback | V2 |
| `src/lib/providers.js` | Read-only `JsonRpcProvider`; MetaMask `BrowserProvider` | V2 |
| `src/lib/roles.js` | Role ids (`keccak256("<NAME>_ROLE")`), `hasRole` detection | V2 |
| `src/lib/format.js` | Status labels, temperatures, addresses, dates | V2 |
| `src/context/WalletContext.jsx` | `useWallet()`: account, roles, `connect`, `switchNetwork`, `getWriteContract` | V2 |
| `src/components/RequireRole.jsx` | Role gate with a clear "missing role" message | V2 |
| `src/components/StatusBadge.jsx`, `RoleBadge.jsx`, `Layout.jsx` | Shared UI | V2 |
| `src/pages/Admin.jsx`, `Manufacturer.jsx` | Participant and batch registration | A8 |
| `src/pages/Custody.jsx`, `src/components/CustodyTimeline.jsx` | Custody actions and timeline | N5, N6 |
| `src/pages/Regulator.jsx` | Regulator dashboard | S6 |
| `src/pages/Verify.jsx`, `src/components/BatchQR.jsx` | Public verify page, QR codes | V3, V4 |

## Writing a role page

```jsx
import RequireRole from "../components/RequireRole.jsx";
import { useWallet } from "../context/WalletContext.jsx";

export default function Manufacturer() {
  const { getWriteContract } = useWallet();
  const register = async () => {
    const contract = await getWriteContract(); // throws a readable error if not ready
    const tx = await contract.registerBatch(name, lot, expiry, certHash);
    await tx.wait();
  };
  return <RequireRole roles={["MANUFACTURER"]}>...</RequireRole>;
}
```

Reads that need no wallet use `getReadContract()` from `src/lib/providers.js`.
