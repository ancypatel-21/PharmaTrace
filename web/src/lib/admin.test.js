import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import { PARTICIPANT_ROLE_KEYS, adminErrorMessage } from "./admin.js";

describe("PARTICIPANT_ROLE_KEYS", () => {
  it("lists the six participant roles and excludes ADMIN", () => {
    expect(PARTICIPANT_ROLE_KEYS).toEqual([
      "MANUFACTURER",
      "DISTRIBUTOR",
      "CARRIER",
      "PHARMACY",
      "REGULATOR",
      "ORACLE",
    ]);
  });
});

describe("adminErrorMessage", () => {
  const iface = new Interface([
    "error AlreadyRegistered(address account, bytes32 role)",
    "error InvalidParticipantRole(bytes32 role)",
  ]);
  const ADDR = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const ROLE = `0x${"11".repeat(32)}`;

  it("uses the decoded revert name from ethers", () => {
    expect(adminErrorMessage({ revert: { name: "ZeroAddress" } })).toMatch(/valid address/);
  });

  it("decodes raw revert data, including data nested by the wallet", () => {
    const data = iface.encodeErrorResult("AlreadyRegistered", [ADDR, ROLE]);
    expect(adminErrorMessage({ data })).toMatch(/already holds/);
    const nested = iface.encodeErrorResult("InvalidParticipantRole", [ROLE]);
    expect(adminErrorMessage({ info: { error: { data: nested } } })).toMatch(/not one of the six/);
  });

  it("reports a wallet rejection and falls back to the ethers message", () => {
    expect(adminErrorMessage({ code: "ACTION_REJECTED" })).toBe("Transaction rejected in the wallet.");
    expect(adminErrorMessage({ shortMessage: "network down" })).toBe("network down");
    expect(adminErrorMessage({ data: "0xdeadbeef" })).toBe("Transaction failed.");
  });
});
