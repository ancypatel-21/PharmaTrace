const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");

const {
  STATUS_NAMES,
  loadConfig,
  resolveRpcUrl,
  resolvePrivateKey,
  describeError,
} = require("../src/oracle-client");
const { parseArgs } = require("../index");

// The ORACLE address scripts/seed-roles.js registers on a local node (Hardhat signer #6).
const LOCAL_ORACLE = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";

describe("resolvePrivateKey", () => {
  it("prefers ORACLE_PRIVATE_KEY when it is set", () => {
    const key = "0x" + "11".repeat(32);
    assert.equal(resolvePrivateKey("amoy", { ORACLE_PRIVATE_KEY: key }), key);
    assert.equal(
      resolvePrivateKey("localhost", { ORACLE_PRIVATE_KEY: key }),
      key,
    );
  });

  it("falls back to the public Hardhat signer #6 on a local node", () => {
    for (const network of ["localhost", "hardhat"]) {
      const key = resolvePrivateKey(network, {});
      assert.equal(new ethers.Wallet(key).address, LOCAL_ORACLE);
    }
  });

  it("never invents a key for a public network", () => {
    assert.throws(
      () => resolvePrivateKey("amoy", {}),
      /ORACLE_PRIVATE_KEY is not set/,
    );
    assert.throws(
      () => resolvePrivateKey("polygon", {}),
      /ORACLE_PRIVATE_KEY is not set/,
    );
  });
});

describe("resolveRpcUrl", () => {
  it("defaults localhost to the local Hardhat node", () => {
    assert.equal(resolveRpcUrl("localhost", {}), "http://127.0.0.1:8545");
  });

  it("reads AMOY_RPC_URL for amoy and errors when it is missing", () => {
    assert.equal(
      resolveRpcUrl("amoy", { AMOY_RPC_URL: "https://rpc.example" }),
      "https://rpc.example",
    );
    assert.throws(() => resolveRpcUrl("amoy", {}), /AMOY_RPC_URL/);
  });

  it("lets RPC_URL override either network", () => {
    assert.equal(
      resolveRpcUrl("localhost", { RPC_URL: "http://127.0.0.1:9999" }),
      "http://127.0.0.1:9999",
    );
    assert.equal(
      resolveRpcUrl("amoy", {
        RPC_URL: "https://other",
        AMOY_RPC_URL: "https://rpc.example",
      }),
      "https://other",
    );
  });

  it("errors for an unknown network with no URL", () => {
    assert.throws(() => resolveRpcUrl("mystery", {}), /No RPC URL/);
  });
});

describe("loadConfig", () => {
  it("loads the exported localhost config with an address and the reportTemperature ABI", () => {
    const config = loadConfig("localhost");
    assert.equal(config.network, "localhost");
    assert.equal(config.chainId, 31337);
    assert.match(config.address, /^0x[0-9a-fA-F]{40}$/);
    const iface = new ethers.Interface(config.abi);
    assert.ok(iface.getFunction("reportTemperature"));
    assert.ok(iface.getFunction("getLatestTemperature"));
  });

  it("explains how to create a missing config", () => {
    assert.throws(
      () => loadConfig("nonexistent-network"),
      /export-abi\.js --network nonexistent-network/,
    );
  });
});

describe("STATUS_NAMES", () => {
  it("matches the Status enum order in PharmaTypes.sol", () => {
    assert.deepEqual(STATUS_NAMES, [
      "Created",
      "InTransit",
      "Received",
      "Stored",
      "Dispensed",
      "Quarantined",
      "Recalled",
    ]);
  });
});

describe("describeError", () => {
  const iface = new ethers.Interface([
    "error BatchNotReportable(uint256 batchId, uint8 status)",
  ]);

  it("names a decoded custom error with its arguments", () => {
    assert.equal(
      describeError(
        { revert: { name: "BatchNotReportable", args: [1n, 5n] } },
        iface,
      ),
      "BatchNotReportable(1, 5)",
    );
  });

  it("decodes raw revert data against the ABI", () => {
    const data = iface.encodeErrorResult("BatchNotReportable", [7, 4]);
    assert.equal(describeError({ data }, iface), "BatchNotReportable(7, 4)");
  });

  it("falls back to the short message, then the message, then the value", () => {
    assert.equal(
      describeError({ shortMessage: "short", message: "long" }, iface),
      "short",
    );
    assert.equal(describeError({ message: "long" }, iface), "long");
    assert.equal(describeError("plain", iface), "plain");
  });

  it("does not throw on revert data it cannot decode", () => {
    assert.equal(
      describeError({ data: "0xdeadbeef", message: "boom" }, iface),
      "boom",
    );
  });
});

describe("CLI parseArgs", () => {
  it("parses valued options", () => {
    assert.deepEqual(
      parseArgs(["--network", "amoy", "--batch", "3", "--scenario", "noisy"]),
      {
        network: "amoy",
        batch: "3",
        scenario: "noisy",
      },
    );
  });

  it("treats --dry-run and --no-write as flags with no value", () => {
    assert.deepEqual(parseArgs(["--dry-run", "--no-write", "--batch", "2"]), {
      "dry-run": true,
      "no-write": true,
      batch: "2",
    });
  });

  it("rejects a missing value and stray arguments", () => {
    assert.throws(() => parseArgs(["--batch"]), /missing value for --batch/);
    assert.throws(() => parseArgs(["oops"]), /unexpected argument "oops"/);
  });
});
