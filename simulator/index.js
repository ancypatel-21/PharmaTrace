// Simulator entry point: generates one window of temperature readings for a batch, summarises
// it and reports the summary on-chain as the ORACLE role.
//
//   npm run sim -- --network localhost --batch 1 --scenario excursion
//
// Options:
//   --network   localhost | amoy                 (default localhost; reads simulator/config/<network>.json)
//   --batch     batch ID to report on            (default 1)
//   --scenario  normal | excursion | noisy       (default normal)
//   --count     readings in the window           (default 12)
//   --interval  seconds between readings         (default 300)
//   --seed      PRNG seed                        (default: the batch ID)
//   --retries   retries for network failures     (default 3)
//   --dry-run   summarise and print, send nothing
//   --no-write  do not save the raw readings to simulator/data/
//
// Environment (.env): ORACLE_PRIVATE_KEY (required on amoy; on localhost the public Hardhat
// account #6 is used if unset), AMOY_RPC_URL, optional RPC_URL to override either network.

const fs = require("fs");
const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});

const { SCENARIOS, generateReadings } = require("./src/generate");
const { summarizeWindow, isExcursion } = require("./src/summarize");
const {
  loadConfig,
  resolveRpcUrl,
  resolvePrivateKey,
  createOracleClient,
} = require("./src/oracle-client");

const DATA_DIR = path.join(__dirname, "data");
const FLAGS = ["dry-run", "no-write"];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument "${arg}"`);
    const name = arg.slice(2);
    if (FLAGS.includes(name)) {
      opts[name] = true;
    } else {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      opts[name] = value;
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

function formatC(tenths) {
  return `${(tenths / 10).toFixed(1)} C`;
}

async function main(argv) {
  const opts = parseArgs(argv);
  const network = opts.network || "localhost";
  const scenario = opts.scenario || "normal";
  const batchId = opts.batch === undefined ? 1 : toInt(opts.batch, "batch");
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(
      `unknown scenario "${scenario}" (expected ${SCENARIOS.join(", ")})`,
    );
  }

  const params = { batchId, scenario };
  if (opts.count !== undefined) params.count = toInt(opts.count, "count");
  if (opts.interval !== undefined)
    params.intervalSeconds = toInt(opts.interval, "interval");
  if (opts.seed !== undefined) params.seed = toInt(opts.seed, "seed");

  const raw = generateReadings(params);
  const { summary, readingsJson, readingsHash } = summarizeWindow(raw);

  console.log(
    `PharmaTrace oracle simulator: ${scenario} scenario, batch ${batchId}, ${network}`,
  );
  console.log(
    `  window     ${summary.readingCount} readings, ${summary.windowStart} -> ${summary.windowEnd}`,
  );
  console.log(
    `  min/max/avg ${formatC(summary.minTenthsC)} / ${formatC(summary.maxTenthsC)} / ` +
      `${formatC(summary.avgTenthsC)}`,
  );
  console.log(`  excursion  ${isExcursion(summary) ? "yes" : "no"}`);
  console.log(`  hash       ${readingsHash}`);

  if (!opts["no-write"]) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(
      DATA_DIR,
      `batch-${batchId}-${scenario}-${summary.windowStart}.json`,
    );
    fs.writeFileSync(file, readingsJson);
    console.log(`  raw data   ${path.relative(process.cwd(), file)}`);
  }

  if (opts["dry-run"]) {
    console.log("dry run: nothing sent");
    return { summary, readingsHash };
  }

  const config = loadConfig(network);
  const client = createOracleClient({
    rpcUrl: resolveRpcUrl(network),
    privateKey: resolvePrivateKey(network),
    address: config.address,
    abi: config.abi,
    retries: opts.retries === undefined ? 3 : toInt(opts.retries, "retries"),
  });

  try {
    await client.assertChain(config.chainId);
    console.log(`  oracle     ${client.address}`);
    console.log(`  contract   ${config.address}`);

    if (!(await client.hasOracleRole())) {
      throw new Error(
        `${client.address} does not hold ORACLE_ROLE. Register it with the admin ` +
          `(registerParticipant); on localhost run scripts/seed-roles.js.`,
      );
    }

    const before = await client.getBatchStatus(batchId);
    if (before === null)
      throw new Error(`batch ${batchId} does not exist on ${network}`);
    console.log(`  status     ${before} (before)`);

    console.log("submitting reportTemperature...");
    const result = await client.submitSummary(batchId, summary, readingsHash);
    console.log(`  tx hash    ${result.txHash}`);
    console.log(`  block      ${result.blockNumber}, gas ${result.gasUsed}`);

    const after = await client.getBatchStatus(batchId);
    const [, reportCount] = await client.getLatestTemperature(batchId);
    console.log(`  status     ${after} (after), report #${reportCount}`);
    console.log(
      result.excursion
        ? "EXCURSION: the contract quarantined the batch."
        : "In range: batch status unchanged.",
    );
    return { summary, readingsHash, ...result };
  } finally {
    client.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main };
