import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Contract, toQuantity } from "ethers";
import { getContractConfig } from "../lib/config.js";
import { getBrowserProvider, getReadProvider, hasInjectedWallet } from "../lib/providers.js";
import { detectRoles } from "../lib/roles.js";

const WalletContext = createContext(null);

/**
 * Wallet state shared by every page:
 *   account, walletChainId, wrongNetwork, roles, rolesLoading, error,
 *   accounts, accountRoles, selectAccount(address), connect(), switchAccount(), disconnect(), switchNetwork(), getWriteContract(), hasRole(key)
 */
export function WalletProvider({ children }) {
  const config = useMemo(() => getContractConfig(), []);
  const [account, setAccount] = useState(null);
  // Every account MetaMask has connected to this site; `account` is the one the app acts as.
  const [accounts, setAccounts] = useState([]);
  const [accountRoles, setAccountRoles] = useState({});
  const [walletChainId, setWalletChainId] = useState(null);
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [error, setError] = useState(null);
  const walletInstalled = hasInjectedWallet();

  // Pick up an already-authorised account on load and follow MetaMask account/network changes.
  useEffect(() => {
    if (!walletInstalled) return undefined;
    const { ethereum } = window;

    const onAccounts = (list) => {
      setAccounts(list);
      setAccount(list[0] ?? null);
    };
    const onChain = (hexId) => setWalletChainId(Number(hexId));

    ethereum.request({ method: "eth_accounts" }).then(onAccounts).catch(() => {});
    ethereum.request({ method: "eth_chainId" }).then(onChain).catch(() => {});
    ethereum.on?.("accountsChanged", onAccounts);
    ethereum.on?.("chainChanged", onChain);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccounts);
      ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [walletInstalled]);

  // Roles are read from the configured network through the read-only provider, so the badge is
  // correct even while MetaMask points at another chain.
  useEffect(() => {
    let cancelled = false;
    if (!account) {
      setRoles([]);
      return undefined;
    }
    setRolesLoading(true);
    detectRoles({ config, account, provider: config.mock ? undefined : getReadProvider() })
      .then((found) => {
        if (!cancelled) {
          setRoles(found);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRoles([]);
          setError(`Could not read roles from ${config.networkName}: ${err.shortMessage ?? err.message}`);
        }
      })
      .finally(() => !cancelled && setRolesLoading(false));
    return () => {
      cancelled = true;
    };
  }, [account, config]);

  // Role labels for the in-app account picker: one lookup per connected account.
  useEffect(() => {
    let cancelled = false;
    if (accounts.length < 2) {
      setAccountRoles({});
      return undefined;
    }
    const provider = config.mock ? undefined : getReadProvider();
    Promise.all(
      accounts.map((a) =>
        detectRoles({ config, account: a, provider })
          .then((found) => [a.toLowerCase(), found])
          .catch(() => [a.toLowerCase(), []]),
      ),
    ).then((pairs) => {
      if (!cancelled) setAccountRoles(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
  }, [accounts, config]);

  const connect = useCallback(async () => {
    setError(null);
    if (!walletInstalled) {
      setError("No browser wallet found. Install MetaMask to send transactions.");
      return;
    }
    try {
      const list = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccounts(list);
      setAccount(list[0] ?? null);
    } catch (err) {
      setError(err.code === 4001 ? "Connection request was rejected." : err.message);
    }
  }, [walletInstalled]);

  /** Opens MetaMask's account picker for this site, so another account can be connected and used. */
  const switchAccount = useCallback(async () => {
    setError(null);
    if (!walletInstalled) return;
    try {
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      const list = await window.ethereum.request({ method: "eth_accounts" });
      setAccounts(list);
      setAccount(list[0] ?? null);
    } catch (err) {
      if (err.code !== 4001) setError(err.message);
    }
  }, [walletInstalled]);

  /** Acts as another account that MetaMask already has connected to this site. */
  const selectAccount = useCallback(
    (address) => {
      const match = accounts.find((a) => a.toLowerCase() === String(address).toLowerCase());
      if (match) setAccount(match);
    },
    [accounts],
  );

  /** Logs out: forgets the account here and asks MetaMask to revoke this site's access. */
  const disconnect = useCallback(async () => {
    setError(null);
    setAccount(null);
    setAccounts([]);
    if (!walletInstalled) return;
    try {
      await window.ethereum.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Older wallets cannot revoke; the app stays logged out until the next connect.
    }
  }, [walletInstalled]);

  const switchNetwork = useCallback(async () => {
    const chainIdHex = toQuantity(config.chainId);
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chainIdHex }],
      });
    } catch (err) {
      // 4902: chain not added to MetaMask yet.
      if (err.code !== 4902) {
        setError(err.message);
        return;
      }
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chainIdHex,
              chainName: config.networkName,
              rpcUrls: [config.rpcUrl],
              nativeCurrency: { name: config.currency, symbol: config.currency, decimals: 18 },
              blockExplorerUrls: config.explorer ? [config.explorer] : undefined,
            },
          ],
        });
      } catch (addErr) {
        setError(addErr.message);
      }
    }
  }, [config]);

  /** Signer-backed ProvenanceTracker for transactions. Throws with a readable message. */
  const getWriteContract = useCallback(async () => {
    if (config.mock) {
      throw new Error("No contract deployed yet: the app is running on the mock ABI.");
    }
    if (!account) throw new Error("Connect a wallet first.");
    if (walletChainId !== config.chainId) {
      throw new Error(`Switch MetaMask to ${config.networkName} (chain ${config.chainId}).`);
    }
    // Sign as the account chosen in the app, not necessarily MetaMask's currently selected one.
    const signer = await getBrowserProvider().getSigner(account);
    return new Contract(config.address, config.abi, signer);
  }, [account, walletChainId, config]);

  const value = useMemo(
    () => ({
      config,
      walletInstalled,
      account,
      accounts,
      accountRoles,
      selectAccount,
      walletChainId,
      wrongNetwork: Boolean(account) && walletChainId !== null && walletChainId !== config.chainId,
      roles,
      rolesLoading,
      error,
      connect,
      switchAccount,
      disconnect,
      switchNetwork,
      getWriteContract,
      hasRole: (key) => roles.includes(key),
    }),
    [config, walletInstalled, account, accounts, accountRoles, selectAccount, walletChainId, roles, rolesLoading, error, connect, switchAccount, disconnect, switchNetwork, getWriteContract],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
