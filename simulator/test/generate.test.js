const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { SCENARIOS, generateReadings } = require("../src/generate");
const { summarize, isExcursion } = require("../src/summarize");

const START = 1_700_000_000;
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

function window(scenario, overrides = {}) {
  return generateReadings({ scenario, startTime: START, ...overrides });
}

describe("generateReadings", () => {
  it("offers the three scenarios", () => {
    assert.deepEqual(SCENARIOS, ["normal", "excursion", "noisy"]);
  });

  it("returns the raw-readings object with the requested shape", () => {
    const raw = window("normal", { batchId: 3, count: 6, intervalSeconds: 60 });
    assert.equal(raw.batchId, 3);
    assert.equal(raw.scenario, "normal");
    assert.equal(raw.intervalSeconds, 60);
    assert.equal(raw.readings.length, 6);
  });

  it("spaces timestamps by the interval, starting at startTime", () => {
    const { readings } = window("normal", { count: 5, intervalSeconds: 120 });
    assert.deepEqual(
      readings.map((r) => r.timestamp),
      [START, START + 120, START + 240, START + 360, START + 480],
    );
  });

  it("uses 12 readings every 5 minutes by default", () => {
    const { readings, intervalSeconds } = window("normal");
    assert.equal(readings.length, 12);
    assert.equal(intervalSeconds, 300);
  });

  it("produces only int16 integer temperatures", () => {
    for (const scenario of SCENARIOS) {
      for (const { tenthsC } of window(scenario, { count: 100 }).readings) {
        assert.ok(Number.isInteger(tenthsC), `${scenario}: ${tenthsC}`);
        assert.ok(tenthsC >= -32768 && tenthsC <= 32767);
      }
    }
  });

  describe("determinism", () => {
    it("gives identical readings for the same seed", () => {
      assert.deepEqual(
        window("excursion", { seed: 42 }),
        window("excursion", { seed: 42 }),
      );
    });

    it("defaults the seed to the batch ID", () => {
      assert.deepEqual(
        window("normal", { batchId: 9 }),
        window("normal", { batchId: 9, seed: 9 }),
      );
    });

    it("gives different readings for different seeds", () => {
      assert.notDeepEqual(
        window("noisy", { seed: 1 }).readings,
        window("noisy", { seed: 2 }).readings,
      );
    });
  });

  describe("scenarios stay on the right side of the 2-8 C range, for every seed tried", () => {
    it("normal never produces an excursion", () => {
      for (const seed of SEEDS) {
        const summary = summarize(window("normal", { seed }).readings);
        assert.equal(
          isExcursion(summary),
          false,
          `seed ${seed}: ${summary.minTenthsC}..${summary.maxTenthsC}`,
        );
      }
    });

    it("excursion always produces an excursion, with a spike above 8.0 C", () => {
      for (const seed of SEEDS) {
        const summary = summarize(window("excursion", { seed }).readings);
        assert.equal(isExcursion(summary), true, `seed ${seed}`);
        assert.ok(
          summary.maxTenthsC > 80,
          `seed ${seed}: max ${summary.maxTenthsC}`,
        );
      }
    });

    it("excursion puts the spike at the end of the window, not the start", () => {
      const { readings } = window("excursion", { count: 12, seed: 5 });
      assert.ok(readings.slice(0, 9).every((r) => r.tenthsC <= 80));
      assert.ok(readings.slice(9).every((r) => r.tenthsC > 80));
    });

    it("excursion spikes even for a window of one reading", () => {
      const summary = summarize(window("excursion", { count: 1 }).readings);
      assert.equal(isExcursion(summary), true);
    });

    it("noisy swings widely but is never quarantined by noise alone", () => {
      let widest = 0;
      for (const seed of SEEDS) {
        const summary = summarize(
          window("noisy", { seed, count: 40 }).readings,
        );
        assert.equal(isExcursion(summary), false, `seed ${seed}`);
        assert.ok(summary.minTenthsC >= 22 && summary.maxTenthsC <= 78);
        widest = Math.max(widest, summary.maxTenthsC - summary.minTenthsC);
      }
      // Noisy must actually be noisier than normal (which stays within 40-60).
      assert.ok(widest > 20, `widest swing was only ${widest}`);
    });
  });

  describe("validation", () => {
    it("rejects an unknown scenario", () => {
      assert.throws(
        () => generateReadings({ scenario: "freezing" }),
        /unknown scenario "freezing"/,
      );
      assert.throws(() => generateReadings({}), /unknown scenario/);
    });

    it("rejects a bad count", () => {
      assert.throws(() => window("normal", { count: 0 }), /count/);
      assert.throws(() => window("normal", { count: 2.5 }), /count/);
      assert.throws(() => window("normal", { count: -1 }), /count/);
    });

    it("rejects a bad interval", () => {
      assert.throws(() => window("normal", { intervalSeconds: 0 }), /interval/);
      assert.throws(
        () => window("normal", { intervalSeconds: 1.5 }),
        /interval/,
      );
    });
  });
});
