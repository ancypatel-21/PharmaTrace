// Temperature sensor simulator: produces readings for one batch at a fixed interval.
//
// Scenarios:
//   normal    - steady around 5.0 C, comfortably inside the 2-8 C range.
//   excursion - normal, then a spike above 8.0 C near the end of the window.
//   noisy     - large swings that stay just inside 2.2-7.8 C, to check nothing is
//               quarantined by noise alone.
//
// Usage (prints a summary and readingsHash per scenario, and writes the raw readings JSON to
// simulator/data/, which is gitignored):
//   node simulator/src/generate.js [--scenario normal|excursion|noisy|all] [--batch 1]
//        [--count 12] [--interval 300] [--start <unix seconds>] [--seed <int>] [--no-write]

const fs = require("fs");
const path = require("path");
const { summarizeWindow, isExcursion } = require("./summarize");

const SCENARIOS = ["normal", "excursion", "noisy"];
const DATA_DIR = path.join(__dirname, "..", "data");

const BASE_TENTHS_C = 50;
const NOISE_TENTHS_C = { normal: 10, excursion: 10, noisy: 28 };

// Small deterministic PRNG (mulberry32) so a given seed always gives the same readings.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Triangular noise in [-amplitude, +amplitude], so values cluster around the base.
function noise(rand, amplitude) {
  return (rand() + rand() - 1) * amplitude;
}

/**
 * Generates `count` readings spaced `intervalSeconds` apart, starting at `startTime`.
 * Returns the raw-readings object that gets hashed and written to simulator/data/.
 */
function generateReadings({
  scenario,
  batchId = 1,
  count = 12,
  intervalSeconds = 300,
  startTime = Math.floor(Date.now() / 1000),
  seed = batchId,
}) {
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(
      `unknown scenario "${scenario}" (expected ${SCENARIOS.join(", ")})`,
    );
  }
  if (!Number.isInteger(count) || count < 1)
    throw new Error("count must be a positive integer");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1) {
    throw new Error("interval must be a positive integer number of seconds");
  }

  const rand = prng(seed);
  const amplitude = NOISE_TENTHS_C[scenario];

  // Excursion spike covers the last quarter of the window (at least one reading).
  const spikeLength = Math.max(1, Math.floor(count / 4));
  const spikeStart = count - spikeLength;

  const readings = [];
  for (let i = 0; i < count; i++) {
    let tenthsC = BASE_TENTHS_C + noise(rand, amplitude);
    if (scenario === "excursion" && i >= spikeStart) {
      tenthsC = 85 + rand() * 15; // 8.5-10.0 C
    }
    if (scenario === "noisy") {
      tenthsC = Math.min(78, Math.max(22, tenthsC));
    }
    readings.push({
      timestamp: startTime + i * intervalSeconds,
      tenthsC: Math.round(tenthsC),
    });
  }

  return { batchId, scenario, intervalSeconds, readings };
}

function formatC(tenths) {
  return `${(tenths / 10).toFixed(1)} C`;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-write") {
      opts.write = false;
    } else if (arg.startsWith("--")) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      opts[arg.slice(2)] = value;
    } else {
      throw new Error(`unexpected argument "${arg}"`);
    }
  }
  return opts;
}

function toInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n))
    throw new Error(`${name} must be an integer, got "${value}"`);
  return n;
}

function main(argv) {
  const opts = parseArgs(argv);
  const scenarioOpt = opts.scenario || "all";
  const scenarios = scenarioOpt === "all" ? SCENARIOS : [scenarioOpt];

  const batchId = opts.batch === undefined ? 1 : toInt(opts.batch, "batch");
  const params = { batchId };
  if (opts.count !== undefined) params.count = toInt(opts.count, "count");
  if (opts.interval !== undefined)
    params.intervalSeconds = toInt(opts.interval, "interval");
  if (opts.start !== undefined) params.startTime = toInt(opts.start, "start");
  if (opts.seed !== undefined) params.seed = toInt(opts.seed, "seed");

  // Same start time for every scenario in one run, so the output is easy to compare.
  if (params.startTime === undefined)
    params.startTime = Math.floor(Date.now() / 1000);

  for (const scenario of scenarios) {
    const raw = generateReadings({ ...params, scenario });
    const { summary, readingsJson, readingsHash } = summarizeWindow(raw);

    console.log(`scenario ${scenario}, batch ${batchId}`);
    console.log(
      `  readings   ${summary.readingCount} every ${raw.intervalSeconds}s`,
    );
    console.log(`  window     ${summary.windowStart} -> ${summary.windowEnd}`);
    console.log(
      `  min/max/avg ${formatC(summary.minTenthsC)} / ${formatC(summary.maxTenthsC)} / ` +
        `${formatC(summary.avgTenthsC)}  (tenths: ${summary.minTenthsC} / ${summary.maxTenthsC})`,
    );
    console.log(
      `  excursion  ${isExcursion(summary) ? "yes, contract would quarantine" : "no"}`,
    );
    console.log(`  hash       ${readingsHash}`);

    if (opts.write !== false) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const file = path.join(
        DATA_DIR,
        `batch-${batchId}-${scenario}-${summary.windowStart}.json`,
      );
      fs.writeFileSync(file, readingsJson);
      console.log(`  raw data   ${path.relative(process.cwd(), file)}`);
    }
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { SCENARIOS, generateReadings };
