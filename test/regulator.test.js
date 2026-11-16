// Regulator workflow tests (S5): quarantineBatch, releaseQuarantine, recallBatch (S3) and
// approveBatch (S4) on the real ProvenanceTracker, deployed through the shared fixture (A6).
// Covers events and arguments, role checks for every regulator action, release restoring the
// previous status, manufacturer recall of its own batches, and the interaction with custody
// transfers (N2) and oracle excursions (B3).

const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { role, deployWithParticipants } = require("./fixtures");

// Same order as `enum Status` in contracts/PharmaTypes.sol.
const Status = {
  Created: 0n,
  InTransit: 1n,
  Received: 2n,
  Stored: 3n,
  Dispensed: 4n,
  Quarantined: 5n,
  Recalled: 6n,
};
const ONE_YEAR = 365 * 24 * 60 * 60;
const CERT = ethers.id("certificate.pdf");
const REASON = "Seal broken on arrival";

async function deploy() {
  const f = await deployWithParticipants();
  const [manufacturer2, stranger] = f.others;
  await f.tracker
    .connect(f.admin)
    .registerParticipant(manufacturer2.address, role("MANUFACTURER"), "Other Pharma");
  const expiry = (await time.latest()) + ONE_YEAR;
  return { ...f, manufacturer2, stranger, expiry };
}

let lot = 0;

/** Registers a batch as `maker` (default: the fixture manufacturer). Returns its ID. */
async function register(f, maker = f.manufacturer) {
  await f.tracker
    .connect(maker)
    .registerBatch("Insulin 10ml", `LOT-${++lot}`, f.expiry, ethers.ZeroHash);
  return f.tracker.totalBatches();
}

/**
 * Registers and approves a batch, then moves it to `state` through the real custody and
 * status functions. InTransit leaves a pending handoff to the distributor.
 */
async function batchIn(f, state) {
  const { tracker, manufacturer, distributor, pharmacy, regulator } = f;
  const id = await register(f);
  await tracker.connect(regulator).approveBatch(id, CERT);
  if (state === "Created") return id;

  await tracker.connect(manufacturer).initiateTransfer(id, distributor.address);
  if (state === "InTransit") return id;

  await tracker.connect(distributor).acceptTransfer(id);
  if (state === "Received") return id;

  await tracker.connect(distributor).markStored(id);
  if (state === "Stored") return id;

  await tracker.connect(distributor).initiateTransfer(id, pharmacy.address);
  await tracker.connect(pharmacy).acceptTransfer(id);
  await tracker.connect(pharmacy).markStored(id);
  await tracker.connect(pharmacy).markDispensed(id);
  return id; // Dispensed
}

async function recalledBatch(f) {
  const id = await batchIn(f, "Created");
  await f.tracker.connect(f.regulator).recallBatch(id, REASON);
  return id;
}

async function quarantinedBatch(f) {
  const id = await batchIn(f, "Created");
  await f.tracker.connect(f.regulator).quarantineBatch(id, REASON);
  return id;
}

const NON_TERMINAL = ["Created", "InTransit", "Received", "Stored"];

describe("Regulator workflow (S5)", function () {
  describe("quarantineBatch", function () {
    for (const state of NON_TERMINAL) {
      it(`quarantines a ${state} batch and records the previous status`, async function () {
        const f = await loadFixture(deploy);
        const id = await batchIn(f, state);

        const tx = f.tracker.connect(f.regulator).quarantineBatch(id, REASON);
        await expect(tx)
          .to.emit(f.tracker, "BatchQuarantined")
          .withArgs(id, REASON, Status[state]);
        await expect(tx)
          .to.emit(f.tracker, "StatusChanged")
          .withArgs(id, Status[state], Status.Quarantined, f.regulator.address);
        expect((await f.tracker.getBatch(id)).status).to.equal(Status.Quarantined);
      });
    }

    it("rejects an already quarantined, recalled or dispensed batch", async function () {
      const f = await loadFixture(deploy);
      for (const id of [
        await quarantinedBatch(f),
        await recalledBatch(f),
        await batchIn(f, "Dispensed"),
      ]) {
        await expect(
          f.tracker.connect(f.regulator).quarantineBatch(id, REASON),
        ).to.be.revertedWithCustomError(f.tracker, "InvalidTransition");
      }
    });

    it("rejects an empty reason and an unknown batch", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "Created");
      await expect(
        f.tracker.connect(f.regulator).quarantineBatch(id, ""),
      ).to.be.revertedWithCustomError(f.tracker, "EmptyReason");
      await expect(f.tracker.connect(f.regulator).quarantineBatch(99, REASON))
        .to.be.revertedWithCustomError(f.tracker, "UnknownBatch")
        .withArgs(99);
    });
  });

  describe("releaseQuarantine", function () {
    for (const state of NON_TERMINAL) {
      it(`restores a batch quarantined from ${state}`, async function () {
        const f = await loadFixture(deploy);
        const id = await batchIn(f, state);
        await f.tracker.connect(f.regulator).quarantineBatch(id, REASON);

        const tx = f.tracker.connect(f.regulator).releaseQuarantine(id);
        await expect(tx)
          .to.emit(f.tracker, "QuarantineReleased")
          .withArgs(id, Status[state]);
        await expect(tx)
          .to.emit(f.tracker, "StatusChanged")
          .withArgs(id, Status.Quarantined, Status[state], f.regulator.address);
        expect((await f.tracker.getBatch(id)).status).to.equal(Status[state]);
      });
    }

    it("restores the status after an oracle excursion quarantine", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "Stored");
      const now = BigInt(await time.latest());
      await f.tracker
        .connect(f.oracle)
        .reportTemperature(id, 40, 95, 12, now - 600n, now, ethers.id("raw"));
      expect((await f.tracker.getBatch(id)).status).to.equal(Status.Quarantined);

      await f.tracker.connect(f.regulator).releaseQuarantine(id);
      expect((await f.tracker.getBatch(id)).status).to.equal(Status.Stored);
    });

    it("keeps a pending handoff: the recipient can accept after release", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "InTransit");
      await f.tracker.connect(f.regulator).quarantineBatch(id, REASON);

      await expect(
        f.tracker.connect(f.distributor).acceptTransfer(id),
      ).to.be.revertedWithCustomError(f.tracker, "InvalidTransition");

      await f.tracker.connect(f.regulator).releaseQuarantine(id);
      expect((await f.tracker.getBatch(id)).pendingCustodian).to.equal(f.distributor.address);
      await f.tracker.connect(f.distributor).acceptTransfer(id);
      expect((await f.tracker.getBatch(id)).currentCustodian).to.equal(f.distributor.address);
    });

    it("rejects a batch that is not quarantined, and an unknown batch", async function () {
      const f = await loadFixture(deploy);
      const created = await batchIn(f, "Created");
      const recalled = await recalledBatch(f);

      await expect(f.tracker.connect(f.regulator).releaseQuarantine(created))
        .to.be.revertedWithCustomError(f.tracker, "NotQuarantined")
        .withArgs(created, Status.Created);
      await expect(f.tracker.connect(f.regulator).releaseQuarantine(recalled))
        .to.be.revertedWithCustomError(f.tracker, "NotQuarantined")
        .withArgs(recalled, Status.Recalled);
      await expect(
        f.tracker.connect(f.regulator).releaseQuarantine(99),
      ).to.be.revertedWithCustomError(f.tracker, "UnknownBatch");
    });
  });

  describe("recallBatch", function () {
    for (const state of NON_TERMINAL) {
      it(`recalls a ${state} batch via Quarantined in one transaction`, async function () {
        const f = await loadFixture(deploy);
        const id = await batchIn(f, state);

        const tx = await f.tracker.connect(f.regulator).recallBatch(id, REASON);
        await expect(tx).to.emit(f.tracker, "BatchRecalled").withArgs(id, REASON);
        await expect(tx)
          .to.emit(f.tracker, "StatusChanged")
          .withArgs(id, Status[state], Status.Quarantined, f.regulator.address);
        await expect(tx)
          .to.emit(f.tracker, "StatusChanged")
          .withArgs(id, Status.Quarantined, Status.Recalled, f.regulator.address);
        await expect(tx).to.not.emit(f.tracker, "BatchQuarantined");

        const batch = await f.tracker.getBatch(id);
        expect(batch.status).to.equal(Status.Recalled);
        expect(batch.pendingCustodian).to.equal(ethers.ZeroAddress);
      });
    }

    it("recalls an already quarantined batch with a single status change", async function () {
      const f = await loadFixture(deploy);
      const id = await quarantinedBatch(f);

      const tx = await f.tracker.connect(f.regulator).recallBatch(id, REASON);
      const receipt = await tx.wait();
      const changes = receipt.logs
        .map((log) => f.tracker.interface.parseLog(log))
        .filter((e) => e && e.name === "StatusChanged");
      expect(changes).to.have.length(1);
      expect(changes[0].args.from).to.equal(Status.Quarantined);
      expect(changes[0].args.to).to.equal(Status.Recalled);
    });

    it("clears a pending handoff so it can be neither accepted nor cancelled", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "InTransit");
      await f.tracker.connect(f.regulator).recallBatch(id, REASON);

      await expect(
        f.tracker.connect(f.distributor).acceptTransfer(id),
      ).to.be.revertedWithCustomError(f.tracker, "NoPendingTransfer");
      await expect(
        f.tracker.connect(f.manufacturer).cancelTransfer(id),
      ).to.be.revertedWithCustomError(f.tracker, "NoPendingTransfer");
    });

    it("blocks every further action on a recalled batch", async function () {
      const f = await loadFixture(deploy);
      const id = await recalledBatch(f);
      const { tracker, regulator, manufacturer, distributor, oracle } = f;
      const now = BigInt(await time.latest());

      await expect(
        tracker.connect(regulator).recallBatch(id, REASON),
      ).to.be.revertedWithCustomError(tracker, "InvalidTransition");
      await expect(
        tracker.connect(regulator).quarantineBatch(id, REASON),
      ).to.be.revertedWithCustomError(tracker, "InvalidTransition");
      await expect(
        tracker.connect(manufacturer).initiateTransfer(id, distributor.address),
      ).to.be.revertedWithCustomError(tracker, "InvalidTransition");
      await expect(
        tracker
          .connect(oracle)
          .reportTemperature(id, 40, 50, 1, now - 60n, now, ethers.id("raw")),
      ).to.be.revertedWithCustomError(tracker, "BatchNotReportable");
    });

    it("rejects a dispensed batch, an empty reason and an unknown batch", async function () {
      const f = await loadFixture(deploy);
      const dispensed = await batchIn(f, "Dispensed");
      const created = await batchIn(f, "Created");

      await expect(
        f.tracker.connect(f.regulator).recallBatch(dispensed, REASON),
      ).to.be.revertedWithCustomError(f.tracker, "InvalidTransition");
      await expect(
        f.tracker.connect(f.regulator).recallBatch(created, ""),
      ).to.be.revertedWithCustomError(f.tracker, "EmptyReason");
      await expect(
        f.tracker.connect(f.regulator).recallBatch(99, REASON),
      ).to.be.revertedWithCustomError(f.tracker, "UnknownBatch");
    });
  });

  describe("manufacturer recall (team decision)", function () {
    it("lets a manufacturer recall its own batch, even while a distributor holds it", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "Stored");

      await expect(f.tracker.connect(f.manufacturer).recallBatch(id, REASON))
        .to.emit(f.tracker, "BatchRecalled")
        .withArgs(id, REASON);
      expect((await f.tracker.getBatch(id)).status).to.equal(Status.Recalled);
    });

    it("lets a manufacturer recall its own unapproved or quarantined batch", async function () {
      const f = await loadFixture(deploy);
      const unapproved = await register(f);
      const quarantined = await quarantinedBatch(f);

      await f.tracker.connect(f.manufacturer).recallBatch(unapproved, REASON);
      await f.tracker.connect(f.manufacturer).recallBatch(quarantined, REASON);
      expect((await f.tracker.getBatch(unapproved)).status).to.equal(Status.Recalled);
      expect((await f.tracker.getBatch(quarantined)).status).to.equal(Status.Recalled);
    });

    it("rejects a manufacturer recalling another manufacturer's batch", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "Created");

      await expect(f.tracker.connect(f.manufacturer2).recallBatch(id, REASON))
        .to.be.revertedWithCustomError(f.tracker, "RecallNotAuthorized")
        .withArgs(id, f.manufacturer2.address);
    });

    it("rejects the original manufacturer once its role is revoked", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "Created");
      await f.tracker.connect(f.admin).revokeParticipant(f.manufacturer.address);

      await expect(f.tracker.connect(f.manufacturer).recallBatch(id, REASON))
        .to.be.revertedWithCustomError(f.tracker, "RecallNotAuthorized")
        .withArgs(id, f.manufacturer.address);
    });
  });

  describe("approveBatch", function () {
    it("approves, records the regulator, replaces the hash and emits BatchApproved", async function () {
      const f = await loadFixture(deploy);
      await f.tracker
        .connect(f.manufacturer)
        .registerBatch("Insulin 10ml", "LOT-HASH", f.expiry, ethers.id("manufacturer-hash"));
      const id = await f.tracker.totalBatches();

      await expect(f.tracker.connect(f.regulator).approveBatch(id, CERT))
        .to.emit(f.tracker, "BatchApproved")
        .withArgs(id, f.regulator.address, CERT);

      const batch = await f.tracker.getBatch(id);
      expect(batch.approved).to.equal(true);
      expect(batch.certificateHash).to.equal(CERT);
      expect(batch.status).to.equal(Status.Created);

      const summary = await f.tracker.getBatchSummary(id);
      expect(summary.approvedBy).to.equal(f.regulator.address);
    });

    it("blocks the first shipment until the batch is approved", async function () {
      const f = await loadFixture(deploy);
      const id = await register(f);

      await expect(f.tracker.connect(f.manufacturer).initiateTransfer(id, f.distributor.address))
        .to.be.revertedWithCustomError(f.tracker, "NotApproved")
        .withArgs(id);

      await f.tracker.connect(f.regulator).approveBatch(id, CERT);
      await expect(
        f.tracker.connect(f.manufacturer).initiateTransfer(id, f.distributor.address),
      ).to.emit(f.tracker, "CustodyTransferInitiated");
    });

    it("does not need re-approval after a cancelled first shipment", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "InTransit");
      await f.tracker.connect(f.manufacturer).cancelTransfer(id);
      expect((await f.tracker.getBatch(id)).status).to.equal(Status.Created);

      await expect(
        f.tracker.connect(f.manufacturer).initiateTransfer(id, f.distributor.address),
      ).to.emit(f.tracker, "CustodyTransferInitiated");
    });

    it("can only approve once", async function () {
      const f = await loadFixture(deploy);
      const id = await batchIn(f, "Created");
      const [, , , , , , , , , regulator2] = await ethers.getSigners();
      await f.tracker
        .connect(f.admin)
        .registerParticipant(regulator2.address, role("REGULATOR"), "Second Authority");

      await expect(f.tracker.connect(regulator2).approveBatch(id, ethers.id("other")))
        .to.be.revertedWithCustomError(f.tracker, "AlreadyApproved")
        .withArgs(id, f.regulator.address);
    });

    it("rejects a zero hash, an unknown batch and frozen batches", async function () {
      const f = await loadFixture(deploy);
      const fresh = await register(f);

      await expect(
        f.tracker.connect(f.regulator).approveBatch(fresh, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(f.tracker, "EmptyCertificateHash");
      await expect(
        f.tracker.connect(f.regulator).approveBatch(99, CERT),
      ).to.be.revertedWithCustomError(f.tracker, "UnknownBatch");

      // Quarantined and Recalled batches cannot be approved.
      const q = await register(f);
      await f.tracker.connect(f.regulator).quarantineBatch(q, REASON);
      await expect(f.tracker.connect(f.regulator).approveBatch(q, CERT))
        .to.be.revertedWithCustomError(f.tracker, "BatchFrozen")
        .withArgs(q, Status.Quarantined);

      const r = await register(f);
      await f.tracker.connect(f.regulator).recallBatch(r, REASON);
      await expect(f.tracker.connect(f.regulator).approveBatch(r, CERT))
        .to.be.revertedWithCustomError(f.tracker, "BatchFrozen")
        .withArgs(r, Status.Recalled);
    });
  });

  describe("role checks for every regulator action", function () {
    // Everyone except the Regulator. The manufacturer is checked against a batch it did not
    // register, so its own-batch recall right does not apply.
    const CALLERS = [
      "admin",
      "manufacturer2",
      "distributor",
      "carrier",
      "pharmacy",
      "oracle",
      "stranger",
    ];

    for (const name of CALLERS) {
      it(`${name} cannot quarantine, release, recall or approve`, async function () {
        const f = await loadFixture(deploy);
        const caller = f[name];
        const created = await batchIn(f, "Created");
        const unapproved = await register(f);
        const quarantined = await quarantinedBatch(f);
        const regulatorRole = role("REGULATOR");

        await expect(f.tracker.connect(caller).quarantineBatch(created, REASON))
          .to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount")
          .withArgs(caller.address, regulatorRole);
        await expect(f.tracker.connect(caller).releaseQuarantine(quarantined))
          .to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount")
          .withArgs(caller.address, regulatorRole);
        await expect(f.tracker.connect(caller).approveBatch(unapproved, CERT))
          .to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount")
          .withArgs(caller.address, regulatorRole);
        await expect(f.tracker.connect(caller).recallBatch(created, REASON))
          .to.be.revertedWithCustomError(f.tracker, "RecallNotAuthorized")
          .withArgs(created, caller.address);
      });
    }

    it("the batch's own manufacturer can recall but not quarantine, release or approve", async function () {
      const f = await loadFixture(deploy);
      const unapproved = await register(f);
      const quarantined = await quarantinedBatch(f);
      const regulatorRole = role("REGULATOR");

      await expect(f.tracker.connect(f.manufacturer).quarantineBatch(unapproved, REASON))
        .to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount")
        .withArgs(f.manufacturer.address, regulatorRole);
      await expect(f.tracker.connect(f.manufacturer).releaseQuarantine(quarantined))
        .to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount")
        .withArgs(f.manufacturer.address, regulatorRole);
      await expect(f.tracker.connect(f.manufacturer).approveBatch(unapproved, CERT))
        .to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount")
        .withArgs(f.manufacturer.address, regulatorRole);
    });

    it("a revoked regulator loses every regulator action", async function () {
      const f = await loadFixture(deploy);
      const created = await batchIn(f, "Created");
      const quarantined = await quarantinedBatch(f);
      await f.tracker.connect(f.admin).revokeParticipant(f.regulator.address);

      await expect(
        f.tracker.connect(f.regulator).quarantineBatch(created, REASON),
      ).to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount");
      await expect(
        f.tracker.connect(f.regulator).releaseQuarantine(quarantined),
      ).to.be.revertedWithCustomError(f.tracker, "AccessControlUnauthorizedAccount");
      await expect(
        f.tracker.connect(f.regulator).recallBatch(created, REASON),
      ).to.be.revertedWithCustomError(f.tracker, "RecallNotAuthorized");
    });
  });
});
