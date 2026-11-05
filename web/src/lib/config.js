// Contract config loader.
//
// scripts/export-abi.js (A7) copies the deployed address + ABI into web/src/contracts/. This
// module picks the file for the selected network (VITE_NETWORK, default "localhost") and falls
// back to the mock ABI compiled from IProvenanceTracker.sol until A7 lands. See
// web/src/contracts/README.md for the expected file format.

import mockConfig from "../contracts/mock/ProvenanceTracker.json";

export const NETWORKS = {
  localhost: {
    chainId: 31337,
    name: "Hardhat local",
    rpcUrl: "http://127.0.0.1:8545",
    currency: "ETH",
    explorer: null,
  },
  amoy: {
    chainId: 80002,
    name: "Polygon Amoy",
    rpcUrl: "https://rpc-amoy.polygon.technology",
    currency: "POL",
    explorer: "https://amoy.polygonscan.com",
  },
};

/**
 * Builds the contract config from the JSON files found in web/src/contracts/.
 *
 * Accepts either one combined file (`<network>.json` with address, chainId and abi) or a
 * split export (`<network>.json` with address/chainId plus `ProvenanceTracker.json` with abi).
 *
 * @param {Record<string, any>} files Map of file path -> parsed JSON (from import.meta.glob).
 * @param {string} network Network key, e.g. "localhost" or "amoy".
 * @param {{ rpcUrl?: string }} [overrides]
 */
export function resolveContractConfig(files, network, overrides = {}) {
  const byName = {};
  for (const [path, mod] of Object.entries(files)) {
    const name = path.split("/").pop().replace(/\.json$/, "");
    byName[name] = mod?.default ?? mod;
  }

  const netInfo = NETWORKS[network] ?? NETWORKS.localhost;
  const deployment = byName[network];
  const abi = deployment?.abi ?? byName.ProvenanceTracker?.abi;
  const address = deployment?.address ?? null;
  const rpcUrl = overrides.rpcUrl || netInfo.rpcUrl;

  if (deployment && address && Array.isArray(abi)) {
    return {
      mock: false,
      network,
      networkName: netInfo.name,
      chainId: Number(deployment.chainId ?? netInfo.chainId),
      address,
      abi,
      rpcUrl,
      explorer: netInfo.explorer,
      currency: netInfo.currency,
    };
  }

  return {
    mock: true,
    network,
    networkName: netInfo.name,
    chainId: netInfo.chainId,
    address: null,
    abi: mockConfig.abi,
    rpcUrl,
    explorer: netInfo.explorer,
    currency: netInfo.currency,
  };
}

let cached;

/** The contract config for this build (cached). */
export function getContractConfig() {
  if (!cached) {
    // Only the top level: the mock lives in ./mock/ and is imported directly above.
    const files = import.meta.glob("../contracts/*.json", { eager: true });
    cached = resolveContractConfig(files, import.meta.env.VITE_NETWORK || "localhost", {
      rpcUrl: import.meta.env.VITE_RPC_URL,
    });
  }
  return cached;
}
