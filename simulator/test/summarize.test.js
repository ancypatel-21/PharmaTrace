const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { keccak256 } = require("ethers");

const {
  MIN_TENTHS_C,
  MAX_TENTHS_C,
  serializeReadings,
  hashReadings,
  summarize,
  isExcursion,
  summarizeWindow,
  toReportArgs,
} = require("../src/summarize");

// Readings at 5-minute spacing from a fixed start, values in tenths of a degree Celsius.
function readingsOf(values, start = 1_700_000_000, step = 300) {
  return values.map((tenthsC, i) => ({ timestamp: start + i * step, tenthsC }));
}

describe("summarize", () => {
  it("finds min, max, count and the window bounds", () => {
    const s = summarize(readingsOf([50, 44, 61, 55]));
    assert.equal(s.minTenthsC, 44);
    assert.equal(s.maxTenthsC, 61);
    assert.equal(s.readingCount, 4);
    assert.equal(s.windowStart, 1_700_000_000);
    assert.equal(s.windowEnd, 1_700_000_900);
  });

  it("computes the average rounded to one decimal of a degree", () => {
    // (50 + 44 + 61 + 55) / 4 = 52.5 tenths
    assert.equal(summarize(readingsOf([50, 44, 61, 55])).avgTenthsC, 52.5);
    // (20 + 21 + 21) / 3 = 20.666... -> 20.7
    assert.equal(summarize(readingsOf([20, 21, 21])).avgTenthsC, 20.7);
  });

  it("handles a single reading", () => {
    const s = summarize(readingsOf([50]));
    assert.equal(s.minTenthsC, 50);
    assert.equal(s.maxTenthsC, 50);
    assert.equal(s.readingCount, 1);
    assert.equal(s.windowStart, s.windowEnd);
  });

  it("handles negative temperatures", () => {
    const s = summarize(readingsOf([-200, -150, 30]));
    assert.equal(s.minTenthsC, -200);
    assert.equal(s.maxTenthsC, 30);
  });

  it("accepts equal timestamps (not strictly increasing)", () => {
    const readings = [
      { timestamp: 100, tenthsC: 50 },
      { timestamp: 100, tenthsC: 52 },
    ];
    assert.doesNotThrow(() => summarize(readings));
  });

  it("does not modify the readings it is given", () => {
    const readings = readingsOf([50, 44, 61]);
    const copy = JSON.parse(JSON.stringify(readings));
    summarize(readings);
    assert.deepEqual(readings, copy);
  });

  describe("validation", () => {
    it("rejects an empty array and non-arrays", () => {
      assert.throws(() => summarize([]), /non-empty array/);
      assert.throws(() => summarize(null), /non-empty array/);
      assert.throws(() => summarize({}), /non-empty array/);
    });

    it("rejects a non-integer temperature", () => {
      assert.throws(
        () => summarize(readingsOf([50, 5.5])),
        /reading 1.*int16 integer/,
      );
      assert.throws(() => summarize(readingsOf([50, "55"])), /int16 integer/);
      assert.throws(() => summarize(readingsOf([NaN])), /int16 integer/);
    });

    it("rejects temperatures outside the int16 range", () => {
      assert.throws(() => summarize(readingsOf([32768])), /int16 integer/);
      assert.throws(() => summarize(readingsOf([-32769])), /int16 integer/);
      assert.doesNotThrow(() => summarize(readingsOf([32767, -32768])));
    });

    it("rejects a bad timestamp", () => {
      assert.throws(
        () => summarize([{ timestamp: -1, tenthsC: 50 }]),
        /timestamp/,
      );
      assert.throws(
        () => summarize([{ timestamp: 1.5, tenthsC: 50 }]),
        /timestamp/,
      );
      assert.throws(() => summarize([{ tenthsC: 50 }]), /timestamp/);
    });

    it("rejects timestamps that go backwards", () => {
      const readings = [
        { timestamp: 200, tenthsC: 50 },
        { timestamp: 100, tenthsC: 50 },
      ];
      assert.throws(() => summarize(readings), /reading 1.*backwards/);
    });
  });
});

describe("isExcursion", () => {
  const range = (minTenthsC, maxTenthsC) => ({ minTenthsC, maxTenthsC });

  it("uses the same inclusive 2.0-8.0 C range as the contract", () => {
    assert.equal(MIN_TENTHS_C, 20);
    assert.equal(MAX_TENTHS_C, 80);
  });

  it("is false inside the range, including exactly 20 and 80", () => {
    assert.equal(isExcursion(range(44, 55)), false);
    assert.equal(isExcursion(range(20, 80)), false);
    assert.equal(isExcursion(range(20, 20)), false);
    assert.equal(isExcursion(range(80, 80)), false);
  });

  it("is true when the minimum is below 20", () => {
    assert.equal(isExcursion(range(19, 50)), true);
    assert.equal(isExcursion(range(-5, 50)), true);
  });

  it("is true when the maximum is above 80", () => {
    assert.equal(isExcursion(range(50, 81)), true);
    assert.equal(isExcursion(range(50, 300)), true);
  });

  it("is true when both ends are out of range", () => {
    assert.equal(isExcursion(range(10, 100)), true);
  });

  it("agrees with summarize on real readings", () => {
    assert.equal(isExcursion(summarize(readingsOf([40, 50, 60]))), false);
    assert.equal(isExcursion(summarize(readingsOf([40, 50, 81]))), true);
    assert.equal(isExcursion(summarize(readingsOf([19, 50, 60]))), true);
  });
});

describe("readingsHash", () => {
  const raw = {
    batchId: 1,
    scenario: "normal",
    intervalSeconds: 300,
    readings: readingsOf([50, 52]),
  };

  it("serialises to compact JSON with no trailing newline", () => {
    const json = serializeReadings(raw);
    assert.equal(json, JSON.stringify(raw));
    assert.ok(!json.endsWith("\n"));
    assert.ok(!json.includes("\n"));
  });

  it("is the keccak256 of the exact UTF-8 bytes of the JSON", () => {
    const json = serializeReadings(raw);
    assert.equal(hashReadings(json), keccak256(Buffer.from(json, "utf8")));
    assert.match(hashReadings(json), /^0x[0-9a-f]{64}$/);
  });

  it("matches the hash of a file written from the same JSON (what an auditor would check)", () => {
    const { readingsJson, readingsHash } = summarizeWindow(raw);
    assert.equal(keccak256(Buffer.from(readingsJson)), readingsHash);
  });

  it("changes if a single reading changes", () => {
    const changed = { ...raw, readings: readingsOf([50, 53]) };
    assert.notEqual(
      summarizeWindow(raw).readingsHash,
      summarizeWindow(changed).readingsHash,
    );
  });

  it("is stable for the same input", () => {
    assert.equal(
      summarizeWindow(raw).readingsHash,
      summarizeWindow(raw).readingsHash,
    );
  });
});

describe("summarizeWindow and toReportArgs", () => {
  const raw = {
    batchId: 7,
    scenario: "excursion",
    intervalSeconds: 300,
    readings: readingsOf([40, 50, 91]),
  };

  it("returns the summary, the JSON and its hash together", () => {
    const { summary, readingsJson, readingsHash } = summarizeWindow(raw);
    assert.equal(summary.maxTenthsC, 91);
    assert.equal(readingsJson, JSON.stringify(raw));
    assert.equal(readingsHash, hashReadings(readingsJson));
  });

  it("propagates validation errors", () => {
    assert.throws(
      () => summarizeWindow({ ...raw, readings: [] }),
      /non-empty array/,
    );
  });

  it("orders the arguments exactly as reportTemperature declares them", () => {
    const { summary, readingsHash } = summarizeWindow(raw);
    assert.deepEqual(toReportArgs(7, summary, readingsHash), [
      7, // batchId
      40, // minTenthsC
      91, // maxTenthsC
      3, // readingCount
      1_700_000_000, // windowStart
      1_700_000_600, // windowEnd
      readingsHash, // readingsHash
    ]);
  });
});
