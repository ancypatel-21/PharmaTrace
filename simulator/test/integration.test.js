// Integration test: starts a real local Hardhat node on a free port, deploys ProvenanceTracker,
// registers the participants, and drives the oracle client against it. No mocks: the client
// talks JSON-RPC to the node exactly as it does for `npm run sim -- --network localhost`.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const net = require("net");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { ethers } = require("ethers");

const {
  createOracleClient,
  resolvePrivateKey,
} = require("../src/oracle-client");
const { generateReadings } = require("../src/generate");
const { summarizeWindow, hashReadings } = require("../src/summarize");

const ROOT = path.join(__dirname, "..", "..");
const ARTIFACT = path.join(
  ROOT,
  "artifacts",
  "contracts",
  "ProvenanceTracker.sol",
  "ProvenanceTracker.json",
);
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

const role = (name) => ethers.id(`${name}_ROLE`);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForRpc(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_chainId",
          params: [],
        }),
      });
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Hardhat node did not start at ${url}`);
}

describe("oracle client against a local Hardhat node", () => {
  let node;
  let rpcUrl;
  let provider;
  let signers; // Hardhat's unlocked accounts, same order as scripts/seed-roles.js
  let tracker; // contract connected as the admin
  let config;
  let dataDir;
  let batchCounter = 0;

  async function newClient(overrides = {}) {
    return createOracleClient({
      rpcUrl,
      privateKey: resolvePrivateKey("localhost", {}),
      address: config.address,
      abi: config.abi,
      retryDelayMs: 10,
      log: () => {},
      ...overrides,
    });
  }

  // Registers a batch, has the Regulator approve it, and hands it to the Distributor: InTransit.
  async function newInTransitBatch() {
    const [, manufacturer, distributor, , , regulator] = signers;
    const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    await (
      await tracker
        .connect(manufacturer)
        .registerBatch(
          "Insulin 10ml",
          `LOT-${++batchCounter}`,
          expiry,
          ethers.id(`cert-${batchCounter}`),
        )
    ).wait();
    const batchId = Number(await tracker.totalBatches());
    await (
      await tracker
        .connect(regulator)
        .approveBatch(batchId, ethers.id(`approval-${batchId}`))
    ).wait();
    await (
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address)
    ).wait();
    return batchId;
  }

  // The same steps the CLI takes: generate, summarise and hash, then keep the raw file on disk.
  function window(scenario, batchId) {
    const raw = generateReadings({ scenario, batchId });
    const result = summarizeWindow(raw);
    const file = path.join(dataDir, `batch-${batchId}-${scenario}.json`);
    fs.writeFileSync(file, result.readingsJson);
    return { ...result, file };
  }

  before(async () => {
    // Compile if needed (a no-op when artifacts are up to date).
    execFileSync(NPX, ["hardhat", "compile", "--quiet"], {
      cwd: ROOT,
      stdio: "ignore",
    });

    const port = await freePort();
    rpcUrl = `http://127.0.0.1:${port}`;
    node = spawn(
      NPX,
      ["hardhat", "node", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: ROOT,
        stdio: "ignore",
        detached: process.platform !== "win32",
      },
    );
    await waitForRpc(rpcUrl);

    provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
      staticNetwork: false,
    });
    signers = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => provider.getSigner(i)),
    );
    const [admin] = signers;

    const artifact = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
    const factory = new ethers.ContractFactory(
      artifact.abi,
      artifact.bytecode,
      admin,
    );
    tracker = await factory.deploy();
    await tracker.waitForDeployment();
    config = {
      address: await tracker.getAddress(),
      abi: artifact.abi,
      chainId: 31337,
    };

    // Same role assignment as scripts/seed-roles.js: signers 1-6.
    const roles = [
      "MANUFACTURER",
      "DISTRIBUTOR",
      "CARRIER",
      "PHARMACY",
      "REGULATOR",
      "ORACLE",
    ];
    for (let i = 0; i < roles.length; i++) {
      const account = await signers[i + 1].getAddress();
      await (
        await tracker.registerParticipant(account, role(roles[i]), roles[i])
      ).wait();
    }

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pharmatrace-sim-"));
  });

  after(async () => {
    provider?.destroy();
    if (node && node.pid) {
      try {
        process.kill(process.platform === "win32" ? node.pid : -node.pid);
      } catch {
        // already gone
      }
    }
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("derives the oracle key that seed-roles.js registers, and the role check passes", async () => {
    const client = await newClient();
    try {
      assert.equal(client.address, await signers[6].getAddress());
      assert.equal(await client.hasOracleRole(), true);
    } finally {
      client.close();
    }
  });

  it("reports false from hasOracleRole for an account without the role", async () => {
    const stranger = ethers.Wallet.createRandom();
    const client = await newClient({ privateKey: stranger.privateKey });
    try {
      assert.equal(await client.hasOracleRole(), false);
    } finally {
      client.close();
    }
  });

  it("confirms the chain ID, and rejects a config for the wrong chain", async () => {
    const client = await newClient();
    try {
      assert.equal(await client.assertChain(31337), 31337);
      await assert.rejects(
        client.assertChain(80002),
        /chain 31337.*chain 80002/,
      );
    } finally {
      client.close();
    }
  });

  it("reads batch status, and null for an unknown batch", async () => {
    const batchId = await newInTransitBatch();
    const client = await newClient();
    try {
      assert.equal(await client.getBatchStatus(batchId), "InTransit");
      assert.equal(await client.getBatchStatus(9999), null);
    } finally {
      client.close();
    }
  });

  it("submits a normal window: stored on-chain, batch stays InTransit, no excursion", async () => {
    const batchId = await newInTransitBatch();
    const { summary, readingsHash } = window("normal", batchId);
    const client = await newClient();
    try {
      const result = await client.submitSummary(batchId, summary, readingsHash);

      assert.match(result.txHash, /^0x[0-9a-f]{64}$/);
      assert.equal(result.excursion, false);
      assert.equal(await client.getBatchStatus(batchId), "InTransit");

      const [latest, count] = await client.getLatestTemperature(batchId);
      assert.equal(count, 1n);
      assert.equal(Number(latest.minTenthsC), summary.minTenthsC);
      assert.equal(Number(latest.maxTenthsC), summary.maxTenthsC);
      assert.equal(Number(latest.readingCount), summary.readingCount);
      assert.equal(Number(latest.windowStart), summary.windowStart);
      assert.equal(Number(latest.windowEnd), summary.windowEnd);
      assert.equal(latest.readingsHash, readingsHash);
    } finally {
      client.close();
    }
  });

  it("submits an excursion window: the contract quarantines the batch", async () => {
    const batchId = await newInTransitBatch();
    const { summary, readingsHash } = window("excursion", batchId);
    const client = await newClient();
    try {
      const result = await client.submitSummary(batchId, summary, readingsHash);

      assert.equal(result.excursion, true);
      assert.equal(await client.getBatchStatus(batchId), "Quarantined");
      const [latest, count] = await client.getLatestTemperature(batchId);
      assert.equal(count, 1n);
      assert.ok(Number(latest.maxTenthsC) > 80);
    } finally {
      client.close();
    }
  });

  it("does not quarantine on a noisy window that stays inside 2-8 C", async () => {
    const batchId = await newInTransitBatch();
    const { summary, readingsHash } = window("noisy", batchId);
    const client = await newClient();
    try {
      const result = await client.submitSummary(batchId, summary, readingsHash);
      assert.equal(result.excursion, false);
      assert.equal(await client.getBatchStatus(batchId), "InTransit");
    } finally {
      client.close();
    }
  });

  it("anchors the raw file: keccak256 of the saved JSON equals the on-chain readingsHash", async () => {
    const batchId = await newInTransitBatch();
    const { summary, readingsHash, file } = window("normal", batchId);
    const client = await newClient();
    try {
      await client.submitSummary(batchId, summary, readingsHash);
      const [latest] = await client.getLatestTemperature(batchId);

      const fileBytes = fs.readFileSync(file);
      assert.equal(ethers.keccak256(fileBytes), latest.readingsHash);
      assert.equal(
        hashReadings(fileBytes.toString("utf8")),
        latest.readingsHash,
      );
    } finally {
      client.close();
    }
  });

  it("counts several reports for one batch and keeps the latest", async () => {
    const batchId = await newInTransitBatch();
    const client = await newClient();
    try {
      const first = window("normal", batchId);
      await client.submitSummary(batchId, first.summary, first.readingsHash);
      const second = summarizeWindow(
        generateReadings({ scenario: "normal", batchId, seed: 99 }),
      );
      await client.submitSummary(batchId, second.summary, second.readingsHash);

      const [latest, count] = await client.getLatestTemperature(batchId);
      assert.equal(count, 2n);
      assert.equal(latest.readingsHash, second.readingsHash);
    } finally {
      client.close();
    }
  });

  it("decodes a revert instead of retrying it (report on an already-quarantined batch)", async () => {
    const batchId = await newInTransitBatch();
    const logs = [];
    const client = await newClient({ log: (line) => logs.push(line) });
    try {
      const bad = window("excursion", batchId);
      await client.submitSummary(batchId, bad.summary, bad.readingsHash);

      const again = window("normal", batchId);
      await assert.rejects(
        client.submitSummary(batchId, again.summary, again.readingsHash),
        /reportTemperature reverted: BatchNotReportable\(\d+, 5\)/,
      );
      assert.ok(
        !logs.some((line) => line.includes("retry")),
        `unexpected retry: ${logs}`,
      );
    } finally {
      client.close();
    }
  });

  it("surfaces AccessControlUnauthorizedAccount when the signer is not the oracle", async () => {
    const batchId = await newInTransitBatch();
    // Hardhat signer #7 is funded but holds no role.
    const funded = ethers.HDNodeWallet.fromPhrase(
      "test test test test test test test test test test test junk",
      undefined,
      "m/44'/60'/0'/0/7",
    );
    const client = await newClient({ privateKey: funded.privateKey });
    try {
      const { summary, readingsHash } = window("normal", batchId);
      await assert.rejects(
        client.submitSummary(batchId, summary, readingsHash),
        /AccessControlUnauthorizedAccount/,
      );
    } finally {
      client.close();
    }
  });

  it("reverts for a batch that was never shipped (Created)", async () => {
    const [, manufacturer] = signers;
    const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
    await (
      await tracker
        .connect(manufacturer)
        .registerBatch(
          "Vaccine",
          `LOT-NS-${Date.now()}`,
          expiry,
          ethers.ZeroHash,
        )
    ).wait();
    const batchId = Number(await tracker.totalBatches());

    const client = await newClient();
    try {
      const { summary, readingsHash } = window("normal", batchId);
      await assert.rejects(
        client.submitSummary(batchId, summary, readingsHash),
        /BatchNotReportable\(\d+, 0\)/,
      );
    } finally {
      client.close();
    }
  });

  it("retries network failures with backoff, then gives up with a clear error", async () => {
    const deadPort = await freePort(); // nothing listens here
    const logs = [];
    const client = await newClient({
      rpcUrl: `http://127.0.0.1:${deadPort}`,
      retries: 2,
      log: (line) => logs.push(line),
    });
    try {
      await assert.rejects(
        client.assertChain(31337),
        /connect failed after 3 attempts/,
      );
      const retryLines = logs.filter((line) => line.includes("retry"));
      assert.equal(retryLines.length, 2);
      assert.match(retryLines[0], /retry 1\/2/);
      assert.match(retryLines[1], /retry 2\/2/);
    } finally {
      client.close();
    }
  });
});
