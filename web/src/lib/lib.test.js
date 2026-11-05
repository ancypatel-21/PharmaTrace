import { describe, expect, it } from "vitest";
import { ZeroHash, keccak256, toUtf8Bytes } from "ethers";
import { resolveContractConfig } from "./config.js";
import { formatTenthsC, isInColdChainRange, shortAddress, statusLabel } from "./format.js";
import { ROLES, detectRoles, roleKeyFromHash } from "./roles.js";

const ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const ABI = ["function totalBatches() view returns (uint256)"];

describe("resolveContractConfig", () => {
  it("falls back to the mock ABI when nothing is exported", () => {
    const cfg = resolveContractConfig({}, "localhost");
    expect(cfg.mock).toBe(true);
    expect(cfg.address).toBeNull();
    expect(cfg.chainId).toBe(31337);
    expect(cfg.abi.some((f) => f.name === "getBatchSummary")).toBe(true);
  });

  it("uses a combined <network>.json export", () => {
    const files = {
      "../contracts/localhost.json": { default: { chainId: 31337, address: ADDR, abi: ABI } },
    };
    const cfg = resolveContractConfig(files, "localhost");
    expect(cfg).toMatchObject({ mock: false, address: ADDR, chainId: 31337, abi: ABI });
  });

  it("uses a split export (address file + ProvenanceTracker.json abi)", () => {
    const files = {
      "../contracts/amoy.json": { default: { chainId: 80002, address: ADDR } },
      "../contracts/ProvenanceTracker.json": { default: { abi: ABI } },
    };
    const cfg = resolveContractConfig(files, "amoy");
    expect(cfg).toMatchObject({ mock: false, chainId: 80002, abi: ABI });
    expect(cfg.explorer).toContain("polygonscan");
  });

  it("ignores another network's export and honours the RPC override", () => {
    const files = { "../contracts/amoy.json": { chainId: 80002, address: ADDR, abi: ABI } };
    const cfg = resolveContractConfig(files, "localhost", { rpcUrl: "http://example:8545" });
    expect(cfg.mock).toBe(true);
    expect(cfg.rpcUrl).toBe("http://example:8545");
  });
});

describe("roles", () => {
  it("matches OpenZeppelin AccessControl role ids", () => {
    expect(ROLES.ADMIN).toBe(ZeroHash);
    expect(ROLES.MANUFACTURER).toBe(keccak256(toUtf8Bytes("MANUFACTURER_ROLE")));
    expect(roleKeyFromHash(ROLES.ORACLE.toUpperCase().replace("0X", "0x"))).toBe("ORACLE");
    expect(roleKeyFromHash("0x1234")).toBeNull();
  });

  it("uses the Hardhat account map in mock mode", async () => {
    const config = { mock: true };
    const manufacturer = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    expect(await detectRoles({ config, account: manufacturer })).toEqual(["MANUFACTURER"]);
    expect(await detectRoles({ config, account: ADDR })).toEqual([]);
    expect(await detectRoles({ config, account: null })).toEqual([]);
  });
});

describe("format", () => {
  it("labels statuses in PharmaTypes order", () => {
    expect(statusLabel(0)).toBe("Created");
    expect(statusLabel(1n)).toBe("In transit");
    expect(statusLabel(6)).toBe("Recalled");
    expect(statusLabel(9)).toBe("Unknown");
  });

  it("formats temperatures and checks the 2-8 C range inclusively", () => {
    expect(formatTenthsC(80)).toBe("8.0 °C");
    expect(formatTenthsC(-5)).toBe("-0.5 °C");
    expect(isInColdChainRange(20, 80)).toBe(true);
    expect(isInColdChainRange(19, 50)).toBe(false);
    expect(isInColdChainRange(30, 81)).toBe(false);
  });

  it("shortens addresses", () => {
    expect(shortAddress(ADDR)).toBe("0x5FbD…0aa3");
    expect(shortAddress(null)).toBe("");
  });
});
