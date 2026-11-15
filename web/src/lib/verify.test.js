import { describe, expect, it } from "vitest";
import { STATUS } from "./format.js";
import {
  buildActivity,
  latestReason,
  parseBatchId,
  temperatureState,
  verificationWarnings,
} from "./verify.js";

const A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const NOW = 1_800_000_000;

const batch = (over = {}) => ({
  status: STATUS.Stored,
  approved: true,
  expiryDate: BigInt(NOW + 86_400),
  ...over,
});

describe("parseBatchId", () => {
  it("accepts positive whole numbers", () => {
    expect(parseBatchId("1")).toBe(1n);
    expect(parseBatchId(" 42 ")).toBe(42n);
  });

  it("rejects zero, negatives, decimals, text and empty input", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "", undefined, "01", "1e3"]) {
      expect(parseBatchId(bad)).toBeNull();
    }
  });
});

describe("buildActivity", () => {
  const log = (name, args, blockNumber, index = 0) => ({ name, args, blockNumber, index, timestamp: blockNumber * 10 });

  it("orders by block and log index and maps each event", () => {
    const activity = buildActivity([
      log("BatchQuarantined", { reason: "Temperature excursion" }, 5, 2),
      log("TemperatureExcursion", { minTenthsC: 30n, maxTenthsC: 95n }, 5, 1),
      log("BatchApproved", { approvedBy: A, certificateHash: "0x01" }, 2),
      log("TemperatureReported", { minTenthsC: 30n, maxTenthsC: 95n, readingCount: 12n }, 5, 0),
    ]);
    expect(activity.map((e) => e.kind)).toEqual(["approved", "temperature", "excursion", "quarantined"]);
    expect(activity[1]).toMatchObject({ min: 30, max: 95, count: 12, inRange: false, timestamp: 50 });
    expect(activity[3].reason).toBe("Temperature excursion");
  });

  it("keeps StatusChanged only for Stored and Dispensed", () => {
    const activity = buildActivity([
      log("StatusChanged", { to: BigInt(STATUS.InTransit), actor: A }, 1),
      log("StatusChanged", { to: BigInt(STATUS.Stored), actor: A }, 2),
      log("StatusChanged", { to: BigInt(STATUS.Quarantined), actor: A }, 3),
      log("StatusChanged", { to: BigInt(STATUS.Dispensed), actor: A }, 4),
    ]);
    expect(activity.map((e) => e.status)).toEqual([STATUS.Stored, STATUS.Dispensed]);
  });

  it("maps release and recall", () => {
    const activity = buildActivity([
      log("QuarantineReleased", { restoredStatus: BigInt(STATUS.Received) }, 1),
      log("BatchRecalled", { reason: "Contamination" }, 2),
    ]);
    expect(activity).toMatchObject([
      { kind: "released", status: STATUS.Received },
      { kind: "recalled", reason: "Contamination" },
    ]);
  });
});

describe("latestReason", () => {
  it("returns the most recent reason of that kind", () => {
    const activity = [
      { kind: "quarantined", reason: "first" },
      { kind: "released" },
      { kind: "quarantined", reason: "second" },
    ];
    expect(latestReason(activity, "quarantined")).toBe("second");
    expect(latestReason(activity, "recalled")).toBeNull();
  });
});

describe("verificationWarnings", () => {
  it("is empty for an approved, in-date, normal batch", () => {
    expect(verificationWarnings({ batch: batch(), nowSeconds: NOW })).toEqual([]);
  });

  it("shows a red recall banner with the reason", () => {
    const w = verificationWarnings({
      batch: batch({ status: STATUS.Recalled }),
      activity: [{ kind: "recalled", reason: "Contamination" }],
      nowSeconds: NOW,
    });
    expect(w[0]).toEqual({ level: "danger", title: expect.stringMatching(/^Recalled/), detail: "Contamination" });
  });

  it("shows a red quarantine banner", () => {
    const w = verificationWarnings({ batch: batch({ status: STATUS.Quarantined }), nowSeconds: NOW });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ level: "danger", title: expect.stringMatching(/^Quarantined/), detail: null });
  });

  it("warns about expiry and missing approval", () => {
    const w = verificationWarnings({
      batch: batch({ approved: false, expiryDate: BigInt(NOW - 1) }),
      nowSeconds: NOW,
    });
    expect(w.map((x) => [x.level, x.title])).toEqual([
      ["warn", "Expired"],
      ["warn", "Not approved by a regulator yet"],
    ]);
  });
});

describe("temperatureState", () => {
  it("reports nothing before the first report", () => {
    expect(temperatureState({ reportedAt: 0n })).toEqual({ reported: false, inRange: null });
    expect(temperatureState(undefined)).toEqual({ reported: false, inRange: null });
  });

  it("checks the 2-8 °C range", () => {
    expect(temperatureState({ reportedAt: 1n, minTenthsC: 20n, maxTenthsC: 80n }).inRange).toBe(true);
    expect(temperatureState({ reportedAt: 1n, minTenthsC: 20n, maxTenthsC: 81n }).inRange).toBe(false);
  });
});
