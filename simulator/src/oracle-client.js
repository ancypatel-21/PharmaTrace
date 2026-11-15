// Oracle client: signs and submits temperature summaries to ProvenanceTracker.reportTemperature
// as the ORACLE role, and retries transient failures (RPC timeouts, dropped connections,
// underpriced or nonce-race transactions). A contract revert is deterministic, so it is never
// retried: it is decoded into a readable message and thrown straight away.

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { toReportArgs } = require("./summarize");

const CONFIG_DIR = path.join(__dirname, "..", "config");

// Public, well-known Hardhat test mnemonic. It holds no real funds and is only used on a local
// node, where scripts/seed-roles.js registers signer index 6 as the ORACLE. Never used on
// a public network: there ORACLE_PRIVATE_KEY from .env is required.
const HARDHAT_MNEMONIC =
  "test test test test test test test test test test test junk";
const HARDHAT_ORACLE_INDEX = 6;
const LOCAL_NETWORKS = ["localhost", "hardhat"];

const DEFAULT_RPC_URLS = { localhost: "http://127.0.0.1:8545" };

const STATUS_NAMES = [
  "Created",
  "InTransit",
  "Received",
  "Stored",
  "Dispensed",
  "Quarantined",
  "Recalled",
];

/** Loads simulator/config/<network>.json ({ network, chainId, address, abi }) from export-abi.js. */
function loadConfig(network) {
  const file = path.join(CONFIG_DIR, `${network}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No simulator config for "${network}" (${file}). ` +
        `Deploy, then run: npx hardhat run scripts/export-abi.js --network ${network}`,
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function resolveRpcUrl(network, env = process.env) {
  const url =
    env.RPC_URL ||
    (network === "amoy" ? env.AMOY_RPC_URL : DEFAULT_RPC_URLS[network]);
  if (!url) {
    throw new Error(
      `No RPC URL for "${network}". Set ${network === "amoy" ? "AMOY_RPC_URL" : "RPC_URL"} in .env.`,
    );
  }
  return url;
}

/** The oracle's private key: ORACLE_PRIVATE_KEY, or the public Hardhat account #6 on a local node. */
function resolvePrivateKey(network, env = process.env) {
  if (env.ORACLE_PRIVATE_KEY) return env.ORACLE_PRIVATE_KEY;
  if (LOCAL_NETWORKS.includes(network)) {
    return ethers.HDNodeWallet.fromPhrase(
      HARDHAT_MNEMONIC,
      undefined,
      `m/44'/60'/0'/0/${HARDHAT_ORACLE_INDEX}`,
    ).privateKey;
  }
  throw new Error(
    `ORACLE_PRIVATE_KEY is not set. Add it to .env (see .env.example).`,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A revert from the contract (not worth retrying), as opposed to a network failure. */
function isRevert(error) {
  return (
    error &&
    (error.code === "CALL_EXCEPTION" || error.code === "ACTION_REJECTED")
  );
}

/** One-line description of a failure, using the contract's custom error name when it has one. */
function describeError(error, iface) {
  if (error && error.revert && error.revert.name) {
    const args = error.revert.args
      ? Array.from(error.revert.args).join(", ")
      : "";
    return `${error.revert.name}(${args})`;
  }
  if (error && error.data && iface) {
    try {
      const parsed = iface.parseError(error.data);
      if (parsed)
        return `${parsed.name}(${Array.from(parsed.args).join(", ")})`;
    } catch {
      // fall through to the plain message
    }
  }
  return (error && (error.shortMessage || error.message)) || String(error);
}

/**
 * Creates an oracle client bound to one deployed ProvenanceTracker.
 * Options: { rpcUrl, privateKey, address, abi, retries = 3, retryDelayMs = 1000, log = console.log }
 */
function createOracleClient({
  rpcUrl,
  privateKey,
  address,
  abi,
  retries = 3,
  retryDelayMs = 1000,
  log = console.log,
}) {
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
    staticNetwork: false,
  });
  const wallet = new ethers.Wallet(privateKey, provider);
  const tracker = new ethers.Contract(address, abi, wallet);

  /** Runs `fn`, retrying network-level failures with a linearly growing delay. */
  async function withRetry(label, fn) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (isRevert(error)) {
          throw new Error(
            `${label} reverted: ${describeError(error, tracker.interface)}`,
          );
        }
        if (attempt > retries) {
          throw new Error(
            `${label} failed after ${attempt} attempts: ${describeError(error, tracker.interface)}`,
          );
        }
        const delay = retryDelayMs * attempt;
        log(
          `  ${label} failed (${describeError(error, tracker.interface)}); ` +
            `retry ${attempt}/${retries} in ${delay} ms`,
        );
        await sleep(delay);
      }
    }
  }

  return {
    address: wallet.address,

    /** Checks the connected chain matches the config before sending anything. */
    async assertChain(expectedChainId) {
      const { chainId } = await withRetry("connect", () =>
        provider.getNetwork(),
      );
      if (
        expectedChainId !== undefined &&
        Number(chainId) !== Number(expectedChainId)
      ) {
        throw new Error(
          `Connected to chain ${chainId}, but the config is for chain ${expectedChainId}.`,
        );
      }
      return Number(chainId);
    },

    /** True if this wallet holds ORACLE_ROLE on the contract. */
    async hasOracleRole() {
      const role = ethers.id("ORACLE_ROLE");
      return withRetry("hasRole", () => tracker.hasRole(role, wallet.address));
    },

    /** The batch's current status name, or null when the batch does not exist. */
    async getBatchStatus(batchId) {
      if (!(await withRetry("batchExists", () => tracker.batchExists(batchId))))
        return null;
      const batch = await withRetry("getBatch", () =>
        tracker.getBatch(batchId),
      );
      return STATUS_NAMES[Number(batch.status)] ?? `Unknown(${batch.status})`;
    },

    /**
     * Submits one summary. Returns { txHash, blockNumber, gasUsed, excursion } where `excursion`
     * is true when the contract emitted TemperatureExcursion (so the batch was quarantined).
     * Retries network failures; a revert throws immediately with the decoded error name.
     */
    async submitSummary(batchId, summary, readingsHash) {
      const args = toReportArgs(batchId, summary, readingsHash);
      return withRetry("reportTemperature", async () => {
        const tx = await tracker.reportTemperature(...args);
        log(`  tx sent: ${tx.hash}`);
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) {
          // A mined-but-failed tx is a revert, not a network problem: do not retry it.
          const failed = new Error("transaction failed on-chain");
          failed.code = "CALL_EXCEPTION";
          throw failed;
        }
        const excursion = receipt.logs.some((entry) => {
          try {
            return (
              tracker.interface.parseLog(entry)?.name === "TemperatureExcursion"
            );
          } catch {
            return false;
          }
        });
        return {
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          excursion,
        };
      });
    },

    /** Reads the stored latest summary back, for confirming a submission. */
    async getLatestTemperature(batchId) {
      return withRetry("getLatestTemperature", () =>
        tracker.getLatestTemperature(batchId),
      );
    },

    close() {
      provider.destroy();
    },
  };
}

module.exports = {
  STATUS_NAMES,
  loadConfig,
  resolveRpcUrl,
  resolvePrivateKey,
  describeError,
  createOracleClient,
};
