// End-to-end tests (V5): both journeys from scripts/e2e-journey.js on the real ProvenanceTracker
// (shared fixture, A6), with temperature windows produced by the simulator code (B2), checked
// step by step on-chain and through the public verify page's data layer
// (web/src/lib/verify.js, V3), so "the verify page shows Recalled" is tested, not assumed.

const path = require("path");
const { pathToFileURL } = require("url");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { deployWithParticipants } = require("./fixtures");
const { runHappyPath, runExcursionPath } = require("../scripts/e2e-journey");

const ZERO = ethers.ZeroAddress;

// web/ is an ES module package; import its verify-page helpers the same way the browser does.
const loadVerifyLib = () =>
  import(pathToFileURL(path.join(__dirname, "..", "web", "src", "lib", "verify.js")).href);

/** Event names emitted by a receipt, in order (only ProvenanceTracker events). */
function eventNames(tracker, receipt) {
  return receipt.logs
    .map((log) => {
      try {
        return tracker.interface.parseLog(log)?.name;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

describe("End-to-end journeys (V5)", function () {
  describe("happy path: register -> approve -> ship -> store -> temperature -> ship -> dispense", function () {
    let f;
    let journey;

    before(async function () {
      f = await loadFixture(deployWithParticipants);
      journey = await runHappyPath(ethers, f.tracker, f);
    });

    it("moves through every status in order", function () {
      expect(journey.steps.map((s) => [s.label, s.status])).to.deep.equal([
        ["registerBatch", "Created"],
        ["approveBatch", "Created"],
        ["initiateTransfer (Manufacturer -> Distributor)", "InTransit"],
        ["acceptTransfer (Distributor)", "Received"],
        ["markStored (Distributor)", "Stored"],
        ["reportTemperature (normal)", "Stored"],
        ["initiateTransfer (Distributor -> Pharmacy)", "InTransit"],
        ["acceptTransfer (Pharmacy)", "Received"],
        ["markStored (Pharmacy)", "Stored"],
        ["markDispensed (Pharmacy)", "Dispensed"],
      ]);
    });

    it("emits the expected event for each step", function () {
      const byLabel = Object.fromEntries(journey.steps.map((s) => [s.label, eventNames(f.tracker, s.receipt)]));
      expect(byLabel.registerBatch).to.include("BatchRegistered");
      expect(byLabel.approveBatch).to.include("BatchApproved");
      expect(byLabel["initiateTransfer (Manufacturer -> Distributor)"]).to.include("CustodyTransferInitiated");
      expect(byLabel["acceptTransfer (Pharmacy)"]).to.include("CustodyTransferAccepted");
      expect(byLabel["markDispensed (Pharmacy)"]).to.include("StatusChanged");
      expect(byLabel["reportTemperature (normal)"]).to.deep.equal(["TemperatureReported"]);
    });

    it("ends dispensed by the pharmacy with both handoffs in the custody history", async function () {
      const batch = await f.tracker.getBatch(journey.batchId);
      expect(batch.currentCustodian).to.equal(f.pharmacy.address);
      expect(batch.pendingCustodian).to.equal(ZERO);

      const history = await f.tracker.getCustodyHistory(journey.batchId);
      expect(history.map((h) => [h.from, h.to])).to.deep.equal([
        [f.manufacturer.address, f.distributor.address],
        [f.distributor.address, f.pharmacy.address],
      ]);
      expect(history.every((h) => h.statusAfter === 2n)).to.equal(true); // Received
    });

    it("anchors the simulator's temperature window and the approval on-chain", async function () {
      const s = await f.tracker.getBatchSummary(journey.batchId);
      expect(s.exists).to.equal(true);
      expect(s.approvedBy).to.equal(f.regulator.address);
      expect(s.temperatureReportCount).to.equal(1n);
      expect(s.latestTemperature.readingsHash).to.equal(journey.temperature.readingsHash);
      expect(Number(s.latestTemperature.minTenthsC)).to.equal(journey.temperature.summary.minTenthsC);
      expect(Number(s.latestTemperature.minTenthsC)).to.be.at.least(20);
      expect(Number(s.latestTemperature.maxTenthsC)).to.be.at.most(80);
    });

    it("verify page data: no warnings, full activity, temperature in range", async function () {
      const { loadVerification, verificationWarnings, temperatureState } = await loadVerifyLib();
      const v = await loadVerification(f.tracker, journey.batchId);

      expect(v.exists).to.equal(true);
      expect(v.eventsError).to.equal(null);
      expect(verificationWarnings({ batch: v.batch, activity: v.activity })).to.deep.equal([]);
      expect(temperatureState(v.temperature)).to.deep.equal({ reported: true, inRange: true });
      expect(v.activity.map((e) => e.kind)).to.deep.equal([
        "approved",
        "status", // Stored by the distributor
        "temperature",
        "status", // Stored by the pharmacy
        "status", // Dispensed
      ]);
      expect(v.activity.at(-1)).to.include({ status: 4, actor: f.pharmacy.address });
    });
  });

  describe("excursion path: ship -> excursion -> automatic quarantine -> recall", function () {
    let f;
    let journey;

    before(async function () {
      f = await loadFixture(deployWithParticipants);
      journey = await runExcursionPath(ethers, f.tracker, f, { recallReason: "Cold-chain breach in transit" });
    });

    it("is quarantined by the excursion report and then recalled", function () {
      expect(journey.steps.map((s) => [s.label, s.status])).to.deep.equal([
        ["registerBatch", "Created"],
        ["approveBatch", "Created"],
        ["initiateTransfer (Manufacturer -> Carrier)", "InTransit"],
        ["reportTemperature (excursion)", "Quarantined"],
        ["recallBatch (Regulator)", "Recalled"],
      ]);
    });

    it("quarantines in the same transaction as the out-of-range report", function () {
      const report = journey.steps.find((s) => s.label === "reportTemperature (excursion)");
      const names = eventNames(f.tracker, report.receipt);
      expect(names).to.include.members(["TemperatureReported", "TemperatureExcursion", "BatchQuarantined", "StatusChanged"]);
      expect(journey.temperature.summary.maxTenthsC).to.be.above(80);
    });

    it("is terminal: the pending carrier can no longer accept it", async function () {
      await expect(f.tracker.connect(f.carrier).acceptTransfer(journey.batchId)).to.be.reverted;
      await expect(
        f.tracker.connect(f.regulator).releaseQuarantine(journey.batchId),
      ).to.be.reverted;
    });

    it("verify page data: red Recalled banner with the reason, excursion and quarantine listed", async function () {
      const { loadVerification, verificationWarnings, temperatureState } = await loadVerifyLib();
      const v = await loadVerification(f.tracker, journey.batchId);

      const warnings = verificationWarnings({ batch: v.batch, activity: v.activity });
      expect(warnings[0]).to.deep.include({ level: "danger", detail: "Cold-chain breach in transit" });
      expect(warnings[0].title).to.match(/^Recalled/);
      expect(temperatureState(v.temperature)).to.deep.equal({ reported: true, inRange: false });

      const kinds = v.activity.map((e) => e.kind);
      expect(kinds).to.deep.equal(["approved", "temperature", "excursion", "quarantined", "recalled"]);
      expect(v.activity.find((e) => e.kind === "quarantined").reason).to.match(/Temperature excursion/);
    });
  });

  it("unknown batch IDs show Not found on the verify page", async function () {
    const f = await loadFixture(deployWithParticipants);
    const { loadVerification } = await loadVerifyLib();
    expect(await loadVerification(f.tracker, 999n)).to.deep.equal({ exists: false });
  });
});
