import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Contract, toQuantity } from "ethers";
import { getContractConfig } from "../lib/config.js";
import { getBrowserProvider, getReadProvider, hasInjectedWallet } from "../lib/providers.js";
import { detectRoles } from "../lib/roles.js";

const WalletContext = createContext(null);

/**
 * Wallet state shared by every page:
 *   account, walletChainId, wrongNetwork, roles, rolesLoading, error,
 *   connect(), switchNetwork(), getWriteContract(), hasRole(key)
 */
export function WalletProvider({ children }) {
  const config = useMemo(() => getContractConfig(), []);
  const [account, setAccount] = useState(null);
  const [walletChainId, setWalletChainId] = useState(null);
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [error, setError] = useState(null);
  const walletInstalled = hasInjectedWallet();

  // Pick up an already-authorised account on load and follow MetaMask account/network changes.
  useEffect(() => {
    if (!walletInstalled) return undefined;
    const { ethereum } = window;

    const onAccounts = (accounts) => setAccount(accounts[0] ?? null);
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

  const connect = useCallback(async () => {
    setError(null);
    if (!walletInstalled) {
      setError("No browser wallet found. Install MetaMask to send transactions.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      setAccount(accounts[0] ?? null);
    } catch (err) {
      setError(err.code === 4001 ? "Connection request was rejected." : err.message);
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
    const signer = await getBrowserProvider().getSigner();
    return new Contract(config.address, config.abi, signer);
  }, [account, walletChainId, config]);

  const value = useMemo(
    () => ({
      config,
      walletInstalled,
      account,
      walletChainId,
      wrongNetwork: Boolean(account) && walletChainId !== null && walletChainId !== config.chainId,
      roles,
      rolesLoading,
      error,
      connect,
      switchNetwork,
      getWriteContract,
      hasRole: (key) => roles.includes(key),
    }),
    [config, walletInstalled, account, walletChainId, roles, rolesLoading, error, connect, switchNetwork, getWriteContract],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
