import { describe, expect, it } from "vitest";
import { Interface } from "ethers";
import {
  buildDirectory,
  buildTimeline,
  canSendFrom,
  classifyBatches,
  custodyErrorMessage,
  eligibleRecipients,
  hasPendingTransfer,
  loadParticipantsSafely,
  nextHopRoles,
  participantName,
} from "./custody.js";
import { STATUS } from "./format.js";
import { ROLES } from "./roles.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const MAKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const DIST = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const CARRIER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const PHARMACY = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

const registered = (account, role, name) => ({ args: { account, role: ROLES[role], name } });

describe("hop table", () => {
  it("matches CustodyModule", () => {
    expect(nextHopRoles(["MANUFACTURER"])).toEqual(["DISTRIBUTOR", "CARRIER"]);
    expect(nextHopRoles(["DISTRIBUTOR"])).toEqual(["CARRIER", "PHARMACY"]);
    expect(nextHopRoles(["CARRIER"])).toEqual(["DISTRIBUTOR", "PHARMACY"]);
    expect(nextHopRoles(["PHARMACY"])).toEqual([]);
    expect(nextHopRoles(["REGULATOR"])).toEqual([]);
  });

  it("unions the hops of every role an account holds", () => {
    expect(nextHopRoles(["MANUFACTURER", "CARRIER"]).sort()).toEqual(["CARRIER", "DISTRIBUTOR", "PHARMACY"]);
  });

  it("only allows sending from Created, Received or Stored", () => {
    expect([0, 1, 2, 3, 4, 5, 6].filter(canSendFrom)).toEqual([
      STATUS.Created,
      STATUS.Received,
      STATUS.Stored,
    ]);
    expect(canSendFrom(3n)).toBe(true);
  });
});

describe("participant directory", () => {
  const directory = buildDirectory([
    registered(MAKER, "MANUFACTURER", "Acme Pharma"),
    registered(DIST, "DISTRIBUTOR", "MedDistrib"),
    registered(CARRIER, "CARRIER", "ColdFreight"),
    registered(CARRIER, "REGULATOR", "ColdFreight Ltd"),
    registered(PHARMACY, "PHARMACY", "CityCare Pharmacy"),
  ]);

  it("merges roles per address and keeps the latest name", () => {
    expect(directory.size).toBe(4);
    expect(directory.get(CARRIER.toLowerCase())).toMatchObject({
      roles: ["CARRIER", "REGULATOR"],
      name: "ColdFreight Ltd",
    });
  });

  it("looks names up case-insensitively", () => {
    expect(participantName(directory, DIST.toUpperCase().replace("0X", "0x"))).toBe("MedDistrib");
    expect(participantName(directory, ZERO)).toBeNull();
  });

  it("falls back to an empty directory when the event query fails", async () => {
    const contract = {
      filters: { ParticipantRegistered: () => ({}) },
      queryFilter: async () => {
        throw Object.assign(new Error("raw"), { shortMessage: "block range too large" });
      },
    };
    const { directory: empty, error } = await loadParticipantsSafely(contract);
    expect(empty.size).toBe(0);
    expect(error).toBe("block range too large");
  });

  it("offers only allowed next hops and never the sender", () => {
    const names = (list) => list.map((p) => p.name).sort();
    expect(names(eligibleRecipients(directory, ["MANUFACTURER"], MAKER))).toEqual(["ColdFreight Ltd", "MedDistrib"]);
    expect(names(eligibleRecipients(directory, ["DISTRIBUTOR"], DIST))).toEqual([
      "CityCare Pharmacy",
      "ColdFreight Ltd",
    ]);
    expect(names(eligibleRecipients(directory, ["CARRIER"], CARRIER))).toEqual(["CityCare Pharmacy", "MedDistrib"]);
    expect(eligibleRecipients(directory, ["PHARMACY"], PHARMACY)).toEqual([]);
  });
});

describe("batches", () => {
  const batch = (id, currentCustodian, pendingCustodian = ZERO, status = STATUS.Created) => ({
    id: BigInt(id),
    currentCustodian,
    pendingCustodian,
    status: BigInt(status),
  });

  it("splits incoming transfers from batches held", () => {
    const batches = [
      batch(1, MAKER, DIST, STATUS.InTransit),
      batch(2, DIST),
      batch(3, CARRIER, PHARMACY, STATUS.InTransit),
    ];
    const { incoming, held } = classifyBatches(batches, DIST.toLowerCase());
    expect(incoming.map((b) => b.id)).toEqual([1n]);
    expect(held.map((b) => b.id)).toEqual([2n]);
    expect(hasPendingTransfer(batches[0])).toBe(true);
    expect(hasPendingTransfer(batches[1])).toBe(false);
  });

  it("builds a timeline: registered, handoffs in order, then the pending handoff", () => {
    const b = {
      manufacturer: MAKER,
      createdAt: 100n,
      currentCustodian: DIST,
      pendingCustodian: PHARMACY,
    };
    const history = [{ from: MAKER, to: DIST, timestamp: 200n, statusAfter: BigInt(STATUS.Received) }];

    expect(buildTimeline(b, history)).toEqual([
      { kind: "registered", to: MAKER, timestamp: 100n, status: STATUS.Created },
      { kind: "handoff", from: MAKER, to: DIST, timestamp: 200n, status: BigInt(STATUS.Received) },
      { kind: "pending", from: DIST, to: PHARMACY },
    ]);
    expect(buildTimeline({ ...b, pendingCustodian: ZERO }, [])).toHaveLength(1);
  });
});

describe("custodyErrorMessage", () => {
  const iface = new Interface([
    "error InvalidNextHop(uint256 batchId, address to)",
    "error InvalidTransition(uint256 batchId, uint8 from, uint8 to)",
  ]);

  it("uses the decoded revert name from ethers", () => {
    expect(custodyErrorMessage({ revert: { name: "NotPendingCustodian" } })).toMatch(/another account/);
  });

  it("decodes raw revert data, including data nested by the wallet", () => {
    const data = iface.encodeErrorResult("InvalidNextHop", [1, DIST]);
    expect(custodyErrorMessage({ data })).toMatch(/can't take this batch/);
    const nested = iface.encodeErrorResult("InvalidTransition", [1, 5, 1]);
    expect(custodyErrorMessage({ info: { error: { data: nested } } })).toMatch(/quarantined/);
  });

  it("reports a wallet rejection and falls back to the ethers message", () => {
    expect(custodyErrorMessage({ code: "ACTION_REJECTED" })).toBe("Transaction rejected in the wallet.");
    expect(custodyErrorMessage({ shortMessage: "network down" })).toBe("network down");
    expect(custodyErrorMessage({ data: "0xdeadbeef" })).toBe("Transaction failed.");
  });
});
