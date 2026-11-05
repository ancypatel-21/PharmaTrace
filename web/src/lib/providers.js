// Providers and contract instances.
//
// - Read-only JsonRpcProvider: no wallet needed. Used by the public verify page and for role
//   detection, so reads always hit the configured network even if MetaMask is elsewhere.
// - BrowserProvider (MetaMask): used for writes; pages get a signer-backed contract from
//   useWallet().getWriteContract().

import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import { getContractConfig } from "./config.js";

let readProvider;

export function getReadProvider() {
  if (!readProvider) {
    const { rpcUrl, chainId } = getContractConfig();
    readProvider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  }
  return readProvider;
}

/**
 * Read-only ProvenanceTracker contract, or null while running on the mock ABI (no address).
 */
export function getReadContract() {
  const config = getContractConfig();
  if (config.mock) return null;
  return new Contract(config.address, config.abi, getReadProvider());
}

export function hasInjectedWallet() {
  return typeof window !== "undefined" && Boolean(window.ethereum);
}

export function getBrowserProvider() {
  if (!hasInjectedWallet()) throw new Error("No browser wallet found. Install MetaMask.");
  return new BrowserProvider(window.ethereum);
}
