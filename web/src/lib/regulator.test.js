import { describe, expect, it } from "vitest";
import { Interface, keccak256, toUtf8Bytes } from "ethers";
import { STATUS } from "./format.js";
import {
  FILTERS,
  batchFacts,
  buildRegulatorIndex,
  cleanReason,
  dashboardCounts,
  filterBatches,
  hashCertificateBytes,
  needsApproval,
  needsAttention,
  parseCertificateHash,
  regulatorActions,
  regulatorErrorMessage,
  sortForReview,
} from "./regulator.js";

const batch = (id, status, approved = true) => ({ id: BigInt(id), status, approved });

const log = (name, args, blockNumber, index = 0) => ({ name, args, blockNumber, index });

describe("buildRegulatorIndex", () => {
  it("counts excursions and keeps the latest reading, in block order", () => {
    const index = buildRegulatorIndex([
      log("TemperatureExcursion", { batchId: 1n, minTenthsC: 30n, maxTenthsC: 120n }, 9),
      log("TemperatureExcursion", { batchId: 1n, minTenthsC: 10n, maxTenthsC: 60n }, 5),
    ]);
    const facts = batchFacts(index, 1n);
    expect(facts.excursions).toBe(2);
    expect(facts.lastExcursion).toEqual({ min: 30, max: 120 });
  });

  it("clears the quarantine reason on release and keeps the recall reason", () => {
    const index = buildRegulatorIndex([
      log("BatchQuarantined", { batchId: 2n, reason: "Seal broken" }, 1),
      log("QuarantineReleased", { batchId: 2n }, 2),
      log("BatchQuarantined", { batchId: 3n, reason: "Audit" }, 3),
      log("BatchRecalled", { batchId: 4n, reason: "Contaminated" }, 4),
    ]);
    expect(batchFacts(index, 2n).quarantineReason).toBeNull();
    expect(batchFacts(index, 3n).quarantineReason).toBe("Audit");
    expect(batchFacts(index, 4n).recallReason).toBe("Contaminated");
  });

  it("orders logs in the same block by log index", () => {
    const index = buildRegulatorIndex([
      log("QuarantineReleased", { batchId: 1n }, 7, 2),
      log("BatchQuarantined", { batchId: 1n, reason: "x" }, 7, 1),
    ]);
    expect(batchFacts(index, 1n).quarantineReason).toBeNull();
  });

  it("gives empty facts for a batch with no events", () => {
    expect(batchFacts(new Map(), 9n)).toEqual({
      excursions: 0,
      lastExcursion: null,
      quarantineReason: null,
      recallReason: null,
    });
  });
});

describe("regulatorActions", () => {
  it("offers approve only to unapproved, non-frozen batches", () => {
    expect(regulatorActions(batch(1, STATUS.Created, false)).approve).toBe(true);
    expect(regulatorActions(batch(1, STATUS.Created, true)).approve).toBe(false);
    for (const s of [STATUS.Quarantined, STATUS.Recalled, STATUS.Dispensed]) {
      expect(regulatorActions(batch(1, s, false)).approve).toBe(false);
    }
  });

  it("matches the contract for every status", () => {
    const expected = {
      [STATUS.Created]: { quarantine: true, release: false, recall: true },
      [STATUS.InTransit]: { quarantine: true, release: false, recall: true },
      [STATUS.Received]: { quarantine: true, release: false, recall: true },
      [STATUS.Stored]: { quarantine: true, release: false, recall: true },
      [STATUS.Quarantined]: { quarantine: false, release: true, recall: true },
      [STATUS.Dispensed]: { quarantine: false, release: false, recall: false },
      [STATUS.Recalled]: { quarantine: false, release: false, recall: false },
    };
    for (const [status, want] of Object.entries(expected)) {
      const { quarantine, release, recall } = regulatorActions(batch(1, Number(status)));
      expect({ quarantine, release, recall }).toEqual(want);
    }
  });
});

describe("attention, filters and sorting", () => {
  const index = buildRegulatorIndex([
    log("TemperatureExcursion", { batchId: 3n, minTenthsC: 40n, maxTenthsC: 95n }, 1),
    log("TemperatureExcursion", { batchId: 5n, minTenthsC: 40n, maxTenthsC: 95n }, 2),
  ]);
  const batches = [
    batch(1, STATUS.Stored),
    batch(2, STATUS.Created, false),
    batch(3, STATUS.Received),
    batch(4, STATUS.Quarantined),
    batch(5, STATUS.Recalled),
  ];

  it("needsApproval and needsAttention", () => {
    expect(needsApproval(batches[1])).toBe(true);
    expect(needsApproval(batches[0])).toBe(false);
    const attention = batches.filter((b) => needsAttention(b, batchFacts(index, b.id)));
    // A recalled batch with an old excursion is closed, so it no longer needs attention.
    expect(attention.map((b) => b.id)).toEqual([2n, 3n, 4n]);
  });

  it("filters by every option", () => {
    const ids = (filter) => filterBatches(batches, filter, index).map((b) => b.id);
    expect(ids("all")).toEqual([1n, 2n, 3n, 4n, 5n]);
    expect(ids("attention")).toEqual([2n, 3n, 4n]);
    expect(ids("approval")).toEqual([2n]);
    expect(ids("excursion")).toEqual([3n, 5n]);
    expect(ids(`status-${STATUS.Quarantined}`)).toEqual([4n]);
    expect(ids(`status-${STATUS.Dispensed}`)).toEqual([]);
    expect(FILTERS.map((f) => f.value)).toContain(`status-${STATUS.Recalled}`);
  });

  it("sorts quarantined, then waiting for approval, then excursions, then by ID", () => {
    expect(sortForReview(batches, index).map((b) => b.id)).toEqual([4n, 2n, 3n, 1n, 5n]);
  });

  it("counts the summary row", () => {
    expect(dashboardCounts(batches, index)).toEqual({
      total: 5,
      approval: 1,
      quarantined: 1,
      excursion: 2,
      recalled: 1,
    });
  });
});

describe("inputs", () => {
  it("accepts a 32-byte hex hash and rejects anything else", () => {
    const h = keccak256(toUtf8Bytes("certificate"));
    expect(parseCertificateHash(` ${h.toUpperCase().replace("0X", "0x")} `)).toBe(h);
    for (const bad of ["", "0x1234", "hello", `0x${"0".repeat(64)}`, `${h}00`, undefined]) {
      expect(parseCertificateHash(bad)).toBeNull();
    }
  });

  it("hashes certificate bytes with keccak256", () => {
    const bytes = toUtf8Bytes("PDF bytes");
    expect(hashCertificateBytes(bytes)).toBe(keccak256(bytes));
  });

  it("trims reasons and rejects empty ones", () => {
    expect(cleanReason("  Seal broken ")).toBe("Seal broken");
    expect(cleanReason("   ")).toBeNull();
    expect(cleanReason(undefined)).toBeNull();
  });
});

describe("regulatorErrorMessage", () => {
  const iface = new Interface([
    "error AlreadyApproved(uint256 batchId, address approvedBy)",
    "error EmptyReason()",
    "error NotApproved(uint256 batchId)",
  ]);

  it("explains regulator errors from raw revert data", () => {
    const data = iface.encodeErrorResult("AlreadyApproved", [1n, `0x${"1".repeat(40)}`]);
    expect(regulatorErrorMessage({ data })).toMatch(/already been approved/);
    expect(regulatorErrorMessage({ revert: { name: "EmptyReason" } })).toMatch(/Enter a reason/);
  });

  it("falls back to the shared custody messages", () => {
    const data = iface.encodeErrorResult("NotApproved", [1n]);
    expect(regulatorErrorMessage({ data })).toMatch(/approve this batch/);
    expect(regulatorErrorMessage({ code: "ACTION_REJECTED" })).toMatch(/rejected/);
  });
});
