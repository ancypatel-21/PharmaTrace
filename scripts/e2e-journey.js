// End-to-end journeys (V5) through the real ProvenanceTracker, using the same simulator code
// (generate + summarize) the oracle client uses, so contract, roles and simulator are exercised
// together:
//
//   Happy path:     register -> approve -> Manufacturer->Distributor send + accept -> store
//                   -> normal temperature report -> Distributor->Pharmacy send + accept
//                   -> store -> dispense
//   Excursion path: register -> approve -> Manufacturer->Carrier send -> excursion report
//                   -> automatic quarantine -> regulator recall
//
// Used two ways:
//   1. test/e2e.test.js runs both journeys on a fresh in-process deployment and checks every step.
//   2. Seed demo data on a running local node (after deploy.js; registers any missing roles):
//
//        npx hardhat node                                              (terminal 1)
//        npx hardhat run scripts/deploy.js --network localhost
//        npx hardhat run scripts/export-abi.js --network localhost
//        npx hardhat run scripts/e2e-journey.js --network localhost
//
//      It prints both batch IDs, their verify-page links and the gas used per step.

const fs = require("fs");
const path = require("path");
const { generateReadings } = require("../simulator/src/generate");
const { summarizeWindow, toReportArgs } = require("../simulator/src/summarize");

const ROLE_NAMES = ["MANUFACTURER", "DISTRIBUTOR", "CARRIER", "PHARMACY", "REGULATOR", "ORACLE"];

// Same display names as scripts/seed-roles.js and test/fixtures.js.
const DEMO_NAMES = {
  MANUFACTURER: "Acme Pharma",
  DISTRIBUTOR: "MedDistrib",
  CARRIER: "ColdFreight",
  PHARMACY: "CityCare Pharmacy",
  REGULATOR: "Health Authority",
  ORACLE: "Sensor Oracle",
};

// Same order as `enum Status` in contracts/PharmaTypes.sol.
const STATUS_NAMES = ["Created", "InTransit", "Received", "Stored", "Dispensed", "Quarantined", "Recalled"];

const ONE_YEAR = 365 * 24 * 60 * 60;
const roleId = (ethers, name) => ethers.id(`${name}_ROLE`);

/**
 * Signers in the order deploy.js / seed-roles.js use on a local node:
 * [0] admin, [1] manufacturer, [2] distributor, [3] carrier, [4] pharmacy, [5] regulator, [6] oracle.
 */
async function localParticipants(ethers) {
  const [admin, manufacturer, distributor, carrier, pharmacy, regulator, oracle] = await ethers.getSigners();
  return { admin, manufacturer, distributor, carrier, pharmacy, regulator, oracle };
}

/** Registers any of the six participant roles that are missing. Safe to run more than once. */
async function ensureParticipants(ethers, tracker, p) {
  const byRole = {
    MANUFACTURER: p.manufacturer,
    DISTRIBUTOR: p.distributor,
    CARRIER: p.carrier,
    PHARMACY: p.pharmacy,
    REGULATOR: p.regulator,
    ORACLE: p.oracle,
  };
  for (const name of ROLE_NAMES) {
    const account = byRole[name].address;
    if (!(await tracker.hasRole(roleId(ethers, name), account))) {
      await (await tracker.connect(p.admin).registerParticipant(account, roleId(ethers, name), DEMO_NAMES[name])).wait();
    }
  }
}

/** Runs one journey step, waits for it, and records the resulting status and gas used. */
async function step(tracker, batchId, steps, label, sendTx) {
  const receipt = await (await sendTx()).wait();
  const status = Number((await tracker.getBatch(batchId)).status);
  steps.push({ label, status: STATUS_NAMES[status], gasUsed: Number(receipt.gasUsed), receipt });
  return receipt;
}

/** Registers a batch as the manufacturer and returns its ID from the BatchRegistered event. */
async function registerBatch(ethers, tracker, p, steps, productName, lotNumber) {
  const latest = await ethers.provider.getBlock("latest");
  const expiry = latest.timestamp + ONE_YEAR;
  const tx = await tracker
    .connect(p.manufacturer)
    .registerBatch(productName, lotNumber, expiry, ethers.id(`certificate-${lotNumber}`));
  const receipt = await tx.wait();
  const event = receipt.logs
    .map((log) => {
      try {
        return tracker.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "BatchRegistered");
  const batchId = event.args.batchId;
  steps.push({ label: "registerBatch", status: "Created", gasUsed: Number(receipt.gasUsed), receipt });
  return batchId;
}

/** Generates and summarises one window with the simulator code, then reports it as the oracle. */
async function reportWindow(ethers, tracker, p, steps, batchId, scenario) {
  const latest = await ethers.provider.getBlock("latest");
  const raw = generateReadings({
    batchId: Number(batchId),
    scenario,
    startTime: latest.timestamp - 12 * 300,
  });
  const { summary, readingsHash } = summarizeWindow(raw);
  await step(tracker, batchId, steps, `reportTemperature (${scenario})`, () =>
    tracker.connect(p.oracle).reportTemperature(...toReportArgs(batchId, summary, readingsHash)),
  );
  return { summary, readingsHash };
}

/** Happy path: a batch travels Manufacturer -> Distributor -> Pharmacy and is dispensed. */
async function runHappyPath(ethers, tracker, p, { lotPrefix = "E2E" } = {}) {
  const steps = [];
  const lot = `${lotPrefix}-OK-${Date.now()}`;
  const batchId = await registerBatch(ethers, tracker, p, steps, "Insulin 10ml", lot);

  await step(tracker, batchId, steps, "approveBatch", () =>
    tracker.connect(p.regulator).approveBatch(batchId, ethers.id(`approved-${lot}`)),
  );
  await step(tracker, batchId, steps, "initiateTransfer (Manufacturer -> Distributor)", () =>
    tracker.connect(p.manufacturer).initiateTransfer(batchId, p.distributor.address),
  );
  await step(tracker, batchId, steps, "acceptTransfer (Distributor)", () =>
    tracker.connect(p.distributor).acceptTransfer(batchId),
  );
  await step(tracker, batchId, steps, "markStored (Distributor)", () =>
    tracker.connect(p.distributor).markStored(batchId),
  );
  const temperature = await reportWindow(ethers, tracker, p, steps, batchId, "normal");
  await step(tracker, batchId, steps, "initiateTransfer (Distributor -> Pharmacy)", () =>
    tracker.connect(p.distributor).initiateTransfer(batchId, p.pharmacy.address),
  );
  await step(tracker, batchId, steps, "acceptTransfer (Pharmacy)", () =>
    tracker.connect(p.pharmacy).acceptTransfer(batchId),
  );
  await step(tracker, batchId, steps, "markStored (Pharmacy)", () => tracker.connect(p.pharmacy).markStored(batchId));
  await step(tracker, batchId, steps, "markDispensed (Pharmacy)", () =>
    tracker.connect(p.pharmacy).markDispensed(batchId),
  );

  return { batchId, lot, steps, temperature };
}

/** Excursion path: a shipment overheats, is quarantined automatically, then recalled. */
async function runExcursionPath(ethers, tracker, p, { lotPrefix = "E2E", recallReason } = {}) {
  const steps = [];
  const lot = `${lotPrefix}-EXC-${Date.now()}`;
  const reason = recallReason ?? "Cold-chain breach: temperature excursion in transit";
  const batchId = await registerBatch(ethers, tracker, p, steps, "Insulin 10ml", lot);

  await step(tracker, batchId, steps, "approveBatch", () =>
    tracker.connect(p.regulator).approveBatch(batchId, ethers.id(`approved-${lot}`)),
  );
  await step(tracker, batchId, steps, "initiateTransfer (Manufacturer -> Carrier)", () =>
    tracker.connect(p.manufacturer).initiateTransfer(batchId, p.carrier.address),
  );
  const temperature = await reportWindow(ethers, tracker, p, steps, batchId, "excursion");
  await step(tracker, batchId, steps, "recallBatch (Regulator)", () =>
    tracker.connect(p.regulator).recallBatch(batchId, reason),
  );

  return { batchId, lot, steps, temperature, reason };
}

function printJourney(title, journey, verifyBase) {
  console.log(`\n${title}: batch #${journey.batchId} (${journey.lot})`);
  for (const s of journey.steps) {
    console.log(`  ${s.label.padEnd(48)} -> ${s.status.padEnd(11)} gas ${s.gasUsed}`);
  }
  console.log(`  Verify page: ${verifyBase}/verify/${journey.batchId}`);
}

async function main() {
  const hre = require("hardhat");
  const { ethers } = hre;
  const network = hre.network.name;
  if (network !== "localhost" && network !== "hardhat") {
    throw new Error("e2e-journey.js only runs on a local node (it uses the default Hardhat signers).");
  }

  let tracker;
  const file = path.join(__dirname, "..", "deployments", `${network}.json`);
  if (network === "localhost") {
    if (!fs.existsSync(file)) throw new Error(`No deployment found for "${network}". Run scripts/deploy.js first.`);
    tracker = await ethers.getContractAt("ProvenanceTracker", JSON.parse(fs.readFileSync(file, "utf8")).address);
  } else {
    tracker = await ethers.deployContract("ProvenanceTracker");
  }

  const p = await localParticipants(ethers);
  await ensureParticipants(ethers, tracker, p);

  const happy = await runHappyPath(ethers, tracker, p);
  const excursion = await runExcursionPath(ethers, tracker, p);

  const verifyBase = process.env.VERIFY_BASE_URL || "http://localhost:5173";
  printJourney("Happy path", happy, verifyBase);
  printJourney("Excursion path", excursion, verifyBase);
}

module.exports = {
  STATUS_NAMES,
  DEMO_NAMES,
  localParticipants,
  ensureParticipants,
  runHappyPath,
  runExcursionPath,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
