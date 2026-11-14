const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { role, deployWithParticipants } = require("./fixtures");

// Status enum values, in declaration order (PharmaTypes.sol).
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
const HASH = ethers.id("raw-readings-json");

// A valid in-range window (4.4 C to 5.5 C), overridable per test.
function report(overrides = {}) {
  return {
    batchId: 1n,
    min: 44,
    max: 55,
    count: 12,
    windowStart: 1_700_000_000n,
    windowEnd: 1_700_003_300n,
    hash: HASH,
    ...overrides,
  };
}

async function send(tracker, signer, r) {
  return tracker
    .connect(signer)
    .reportTemperature(
      r.batchId,
      r.min,
      r.max,
      r.count,
      r.windowStart,
      r.windowEnd,
      r.hash,
    );
}

// Batch 1, registered, approved by the Regulator and handed to the Distributor: InTransit.
async function deployInTransit() {
  const fixture = await deployWithParticipants();
  const { tracker, manufacturer, distributor, regulator } = fixture;

  const expiry = (await time.latest()) + ONE_YEAR;
  await tracker
    .connect(manufacturer)
    .registerBatch(
      "Insulin 10ml",
      "LOT-001",
      expiry,
      ethers.id("cert-LOT-001"),
    );
  await tracker
    .connect(regulator)
    .approveBatch(1, ethers.id("approval-LOT-001"));
  await tracker.connect(manufacturer).initiateTransfer(1, distributor.address);
  return fixture;
}

// Same batch, registered but never shipped: still Created.
async function deployCreated() {
  const fixture = await deployWithParticipants();
  const { tracker, manufacturer } = fixture;
  const expiry = (await time.latest()) + ONE_YEAR;
  await tracker
    .connect(manufacturer)
    .registerBatch(
      "Insulin 10ml",
      "LOT-001",
      expiry,
      ethers.id("cert-LOT-001"),
    );
  return fixture;
}

// Moves the in-transit batch to Received (Distributor accepts).
async function toReceived(f) {
  await f.tracker.connect(f.distributor).acceptTransfer(1);
}

// Received, then Stored (Distributor marks it stored).
async function toStored(f) {
  await toReceived(f);
  await f.tracker.connect(f.distributor).markStored(1);
}

// Walks the batch all the way to Dispensed via the Pharmacy.
async function toDispensed(f) {
  await toStored(f);
  await f.tracker
    .connect(f.distributor)
    .initiateTransfer(1, f.pharmacy.address);
  await f.tracker.connect(f.pharmacy).acceptTransfer(1);
  await f.tracker.connect(f.pharmacy).markStored(1);
  await f.tracker.connect(f.pharmacy).markDispensed(1);
}

describe("OracleModule", function () {
  describe("constants", function () {
    it("exposes the 2-8 C safe range in tenths of a degree", async function () {
      const { tracker } = await loadFixture(deployInTransit);
      expect(await tracker.MIN_SAFE_TENTHS_C()).to.equal(20n);
      expect(await tracker.MAX_SAFE_TENTHS_C()).to.equal(80n);
    });
  });

  describe("access control", function () {
    it("rejects a report from an account with no role", async function () {
      const { tracker, others } = await loadFixture(deployInTransit);
      await expect(send(tracker, others[0], report()))
        .to.be.revertedWithCustomError(
          tracker,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(others[0].address, role("ORACLE"));
    });

    it("rejects a report from every other participant role and the admin", async function () {
      const f = await loadFixture(deployInTransit);
      for (const signer of [
        f.admin,
        f.manufacturer,
        f.distributor,
        f.carrier,
        f.pharmacy,
        f.regulator,
      ]) {
        await expect(send(f.tracker, signer, report()))
          .to.be.revertedWithCustomError(
            f.tracker,
            "AccessControlUnauthorizedAccount",
          )
          .withArgs(signer.address, role("ORACLE"));
      }
    });

    it("rejects a report from an oracle whose role was revoked", async function () {
      const { tracker, admin, oracle } = await loadFixture(deployInTransit);
      await tracker.connect(admin).revokeParticipant(oracle.address);
      await expect(send(tracker, oracle, report()))
        .to.be.revertedWithCustomError(
          tracker,
          "AccessControlUnauthorizedAccount",
        )
        .withArgs(oracle.address, role("ORACLE"));
    });

    it("checks the role before anything else, even for an unknown batch", async function () {
      const { tracker, others } = await loadFixture(deployInTransit);
      await expect(
        send(tracker, others[0], report({ batchId: 99n })),
      ).to.be.revertedWithCustomError(
        tracker,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("in-range report", function () {
    it("keeps the batch InTransit and emits only TemperatureReported", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);

      const tx = send(tracker, oracle, report());
      await expect(tx)
        .to.emit(tracker, "TemperatureReported")
        .withArgs(1n, 44, 55, 12);
      await expect(tx).to.not.emit(tracker, "TemperatureExcursion");
      await expect(tx).to.not.emit(tracker, "BatchQuarantined");
      await expect(tx).to.not.emit(tracker, "StatusChanged");

      expect((await tracker.getBatch(1)).status).to.equal(Status.InTransit);
    });

    it("stores the summary with reportedAt set to the block timestamp", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      const r = report();

      await send(tracker, oracle, r);
      const blockTime = BigInt(await time.latest());

      const [summary, count] = await tracker.getLatestTemperature(1);
      expect(count).to.equal(1n);
      expect(summary.minTenthsC).to.equal(r.min);
      expect(summary.maxTenthsC).to.equal(r.max);
      expect(summary.readingCount).to.equal(r.count);
      expect(summary.windowStart).to.equal(r.windowStart);
      expect(summary.windowEnd).to.equal(r.windowEnd);
      expect(summary.readingsHash).to.equal(r.hash);
      expect(summary.reportedAt).to.equal(blockTime);
    });

    it("keeps only the latest summary and counts every report", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);

      await send(tracker, oracle, report({ min: 44, max: 55 }));
      await send(
        tracker,
        oracle,
        report({ min: 30, max: 70, count: 6, hash: ethers.id("second") }),
      );

      const [summary, count] = await tracker.getLatestTemperature(1);
      expect(count).to.equal(2n);
      expect(summary.minTenthsC).to.equal(30);
      expect(summary.maxTenthsC).to.equal(70);
      expect(summary.readingCount).to.equal(6n);
      expect(summary.readingsHash).to.equal(ethers.id("second"));
    });

    it("is accepted while the batch is Received", async function () {
      const f = await loadFixture(deployInTransit);
      await toReceived(f);
      await expect(send(f.tracker, f.oracle, report())).to.emit(
        f.tracker,
        "TemperatureReported",
      );
      expect((await f.tracker.getBatch(1)).status).to.equal(Status.Received);
    });

    it("is accepted while the batch is Stored", async function () {
      const f = await loadFixture(deployInTransit);
      await toStored(f);
      await expect(send(f.tracker, f.oracle, report())).to.emit(
        f.tracker,
        "TemperatureReported",
      );
      expect((await f.tracker.getBatch(1)).status).to.equal(Status.Stored);
    });

    it("accepts a single-reading window (windowStart equals windowEnd)", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(
        send(
          tracker,
          oracle,
          report({ min: 50, max: 50, count: 1, windowEnd: 1_700_000_000n }),
        ),
      ).to.emit(tracker, "TemperatureReported");
    });

    it("is reflected in getBatchSummary", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await send(tracker, oracle, report());

      const [exists, batch, latest, count] = await tracker.getBatchSummary(1);
      expect(exists).to.equal(true);
      expect(batch.status).to.equal(Status.InTransit);
      expect(latest.readingsHash).to.equal(HASH);
      expect(count).to.equal(1n);
    });
  });

  describe("excursion", function () {
    it("quarantines the batch when the maximum is above 8.0 C", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);

      await expect(send(tracker, oracle, report({ min: 44, max: 91 })))
        .to.emit(tracker, "TemperatureExcursion")
        .withArgs(1n, 44, 91);

      expect((await tracker.getBatch(1)).status).to.equal(Status.Quarantined);
    });

    it("quarantines the batch when the minimum is below 2.0 C", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);

      await expect(send(tracker, oracle, report({ min: -15, max: 55 })))
        .to.emit(tracker, "TemperatureExcursion")
        .withArgs(1n, -15, 55);

      expect((await tracker.getBatch(1)).status).to.equal(Status.Quarantined);
    });

    it("quarantines when both ends are out of range", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await send(tracker, oracle, report({ min: 5, max: 120 }));
      expect((await tracker.getBatch(1)).status).to.equal(Status.Quarantined);
    });

    it("emits TemperatureReported, TemperatureExcursion, StatusChanged and BatchQuarantined", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);

      const tx = send(tracker, oracle, report({ min: 44, max: 91 }));
      await expect(tx)
        .to.emit(tracker, "TemperatureReported")
        .withArgs(1n, 44, 91, 12);
      await expect(tx)
        .to.emit(tracker, "TemperatureExcursion")
        .withArgs(1n, 44, 91);
      await expect(tx)
        .to.emit(tracker, "StatusChanged")
        .withArgs(1n, Status.InTransit, Status.Quarantined, oracle.address);
      await expect(tx)
        .to.emit(tracker, "BatchQuarantined")
        .withArgs(1n, "Temperature excursion: outside 2-8 C", Status.InTransit);
    });

    it("still stores the excursion summary and counts the report", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await send(tracker, oracle, report({ min: 44, max: 91 }));

      const [summary, count] = await tracker.getLatestTemperature(1);
      expect(count).to.equal(1n);
      expect(summary.maxTenthsC).to.equal(91);
      expect(summary.readingsHash).to.equal(HASH);
    });

    it("records the prior status, so a Received batch is restored to Received on release", async function () {
      const f = await loadFixture(deployInTransit);
      await toReceived(f);

      await expect(send(f.tracker, f.oracle, report({ max: 91 })))
        .to.emit(f.tracker, "BatchQuarantined")
        .withArgs(1n, "Temperature excursion: outside 2-8 C", Status.Received);

      await f.tracker.connect(f.regulator).releaseQuarantine(1);
      expect((await f.tracker.getBatch(1)).status).to.equal(Status.Received);
    });

    it("lets a Regulator release an oracle quarantine back to InTransit", async function () {
      const { tracker, oracle, regulator } = await loadFixture(deployInTransit);
      await send(tracker, oracle, report({ max: 91 }));

      await expect(tracker.connect(regulator).releaseQuarantine(1))
        .to.emit(tracker, "QuarantineReleased")
        .withArgs(1n, Status.InTransit);
      expect((await tracker.getBatch(1)).status).to.equal(Status.InTransit);
    });

    it("blocks the pending handoff from being accepted while quarantined", async function () {
      const { tracker, oracle, distributor } =
        await loadFixture(deployInTransit);
      await send(tracker, oracle, report({ max: 91 }));
      await expect(tracker.connect(distributor).acceptTransfer(1)).to.be
        .reverted;
    });

    it("rejects further reports once the batch is Quarantined", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await send(tracker, oracle, report({ max: 91 }));

      await expect(send(tracker, oracle, report()))
        .to.be.revertedWithCustomError(tracker, "BatchNotReportable")
        .withArgs(1n, Status.Quarantined);
    });

    it("accepts reports again after the quarantine is released", async function () {
      const { tracker, oracle, regulator } = await loadFixture(deployInTransit);
      await send(tracker, oracle, report({ max: 91 }));
      await tracker.connect(regulator).releaseQuarantine(1);

      await expect(send(tracker, oracle, report())).to.emit(
        tracker,
        "TemperatureReported",
      );
      const [, count] = await tracker.getLatestTemperature(1);
      expect(count).to.equal(2n);
    });
  });

  describe("boundary values (2.0 C = 20, 8.0 C = 80, inclusive)", function () {
    it("treats exactly 20 and 80 as in range", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);

      const tx = send(tracker, oracle, report({ min: 20, max: 80 }));
      await expect(tx).to.emit(tracker, "TemperatureReported");
      await expect(tx).to.not.emit(tracker, "TemperatureExcursion");
      expect((await tracker.getBatch(1)).status).to.equal(Status.InTransit);
    });

    it("treats a minimum of 19 as an excursion", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(send(tracker, oracle, report({ min: 19, max: 50 })))
        .to.emit(tracker, "TemperatureExcursion")
        .withArgs(1n, 19, 50);
      expect((await tracker.getBatch(1)).status).to.equal(Status.Quarantined);
    });

    it("treats a maximum of 81 as an excursion", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(send(tracker, oracle, report({ min: 50, max: 81 })))
        .to.emit(tracker, "TemperatureExcursion")
        .withArgs(1n, 50, 81);
      expect((await tracker.getBatch(1)).status).to.equal(Status.Quarantined);
    });

    it("treats min 20 with max 81, and min 19 with max 80, as excursions", async function () {
      const f = await loadFixture(deployInTransit);
      await expect(
        send(f.tracker, f.oracle, report({ min: 20, max: 81 })),
      ).to.emit(f.tracker, "TemperatureExcursion");

      const g = await deployInTransit();
      await expect(
        send(g.tracker, g.oracle, report({ min: 19, max: 80 })),
      ).to.emit(g.tracker, "TemperatureExcursion");
    });

    it("handles a reading pinned at one boundary (min equals max)", async function () {
      const f = await loadFixture(deployInTransit);
      await expect(
        send(f.tracker, f.oracle, report({ min: 20, max: 20, count: 1 })),
      ).to.not.emit(f.tracker, "TemperatureExcursion");
      await expect(
        send(f.tracker, f.oracle, report({ min: 80, max: 80, count: 1 })),
      ).to.not.emit(f.tracker, "TemperatureExcursion");
    });

    it("handles negative temperatures (freezer excursion)", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(send(tracker, oracle, report({ min: -200, max: -150 })))
        .to.emit(tracker, "TemperatureExcursion")
        .withArgs(1n, -200, -150);
    });

    it("accepts the extreme int16 values", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(send(tracker, oracle, report({ min: -32768, max: 32767 })))
        .to.emit(tracker, "TemperatureExcursion")
        .withArgs(1n, -32768, 32767);
    });
  });

  describe("batches that cannot be reported on", function () {
    it("reverts for an unknown batch", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(send(tracker, oracle, report({ batchId: 99n })))
        .to.be.revertedWithCustomError(tracker, "UnknownBatch")
        .withArgs(99n);
    });

    it("reverts for batch ID 0", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(send(tracker, oracle, report({ batchId: 0n })))
        .to.be.revertedWithCustomError(tracker, "UnknownBatch")
        .withArgs(0n);
    });

    it("reverts for a batch that is still Created", async function () {
      const { tracker, oracle } = await loadFixture(deployCreated);
      await expect(send(tracker, oracle, report()))
        .to.be.revertedWithCustomError(tracker, "BatchNotReportable")
        .withArgs(1n, Status.Created);
    });

    it("reverts for a Dispensed batch", async function () {
      const f = await loadFixture(deployInTransit);
      await toDispensed(f);
      expect((await f.tracker.getBatch(1)).status).to.equal(Status.Dispensed);

      await expect(send(f.tracker, f.oracle, report()))
        .to.be.revertedWithCustomError(f.tracker, "BatchNotReportable")
        .withArgs(1n, Status.Dispensed);
    });

    it("reverts for a Recalled batch", async function () {
      const { tracker, oracle, regulator } = await loadFixture(deployInTransit);
      await tracker.connect(regulator).recallBatch(1, "Contaminated lot");

      await expect(send(tracker, oracle, report()))
        .to.be.revertedWithCustomError(tracker, "BatchNotReportable")
        .withArgs(1n, Status.Recalled);
    });

    it("reverts for a batch quarantined by a Regulator", async function () {
      const { tracker, oracle, regulator } = await loadFixture(deployInTransit);
      await tracker.connect(regulator).quarantineBatch(1, "Under review");

      await expect(send(tracker, oracle, report()))
        .to.be.revertedWithCustomError(tracker, "BatchNotReportable")
        .withArgs(1n, Status.Quarantined);
    });

    it("does not change state or count when a report reverts", async function () {
      const { tracker, oracle, regulator } = await loadFixture(deployInTransit);
      await tracker.connect(regulator).recallBatch(1, "Contaminated lot");
      await expect(send(tracker, oracle, report({ max: 91 })))
        .to.be.revertedWithCustomError(tracker, "BatchNotReportable")
        .withArgs(1n, Status.Recalled);

      const [summary, count] = await tracker.getLatestTemperature(1);
      expect(count).to.equal(0n);
      expect(summary.reportedAt).to.equal(0n);
      expect((await tracker.getBatch(1)).status).to.equal(Status.Recalled);
    });
  });

  describe("argument validation", function () {
    it("rejects a minimum above the maximum", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(send(tracker, oracle, report({ min: 60, max: 50 })))
        .to.be.revertedWithCustomError(tracker, "InvalidTemperatureRange")
        .withArgs(60, 50);
    });

    it("rejects zero readings", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      const r = report({ count: 0 });
      await expect(send(tracker, oracle, r))
        .to.be.revertedWithCustomError(tracker, "InvalidReadingWindow")
        .withArgs(0, r.windowStart, r.windowEnd);
    });

    it("rejects a window that ends before it starts", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      const r = report({ windowStart: 2_000n, windowEnd: 1_000n });
      await expect(send(tracker, oracle, r))
        .to.be.revertedWithCustomError(tracker, "InvalidReadingWindow")
        .withArgs(r.count, 2_000n, 1_000n);
    });

    it("validates the arguments before quarantining, so an invalid excursion changes nothing", async function () {
      const { tracker, oracle } = await loadFixture(deployInTransit);
      await expect(
        send(tracker, oracle, report({ min: 95, max: 90, count: 0 })),
      )
        .to.be.revertedWithCustomError(tracker, "InvalidTemperatureRange")
        .withArgs(95, 90);
      expect((await tracker.getBatch(1)).status).to.equal(Status.InTransit);
    });
  });

  describe("getLatestTemperature", function () {
    it("returns a zero struct and count 0 before any report", async function () {
      const { tracker } = await loadFixture(deployInTransit);
      const [summary, count] = await tracker.getLatestTemperature(1);
      expect(count).to.equal(0n);
      expect(summary.reportedAt).to.equal(0n);
      expect(summary.readingCount).to.equal(0n);
      expect(summary.readingsHash).to.equal(ethers.ZeroHash);
    });

    it("does not revert for an unknown batch", async function () {
      const { tracker } = await loadFixture(deployInTransit);
      const [summary, count] = await tracker.getLatestTemperature(99);
      expect(count).to.equal(0n);
      expect(summary.reportedAt).to.equal(0n);
    });

    it("keeps each batch's reports separate", async function () {
      const f = await loadFixture(deployInTransit);
      const expiry = (await time.latest()) + ONE_YEAR;
      await f.tracker
        .connect(f.manufacturer)
        .registerBatch("Vaccine", "LOT-002", expiry, ethers.id("cert-LOT-002"));
      await f.tracker
        .connect(f.regulator)
        .approveBatch(2, ethers.id("approval-LOT-002"));
      await f.tracker
        .connect(f.manufacturer)
        .initiateTransfer(2, f.distributor.address);

      await send(f.tracker, f.oracle, report({ batchId: 1n, max: 91 }));
      await send(f.tracker, f.oracle, report({ batchId: 2n }));

      expect((await f.tracker.getBatch(1)).status).to.equal(Status.Quarantined);
      expect((await f.tracker.getBatch(2)).status).to.equal(Status.InTransit);
      expect((await f.tracker.getLatestTemperature(1))[1]).to.equal(1n);
      expect((await f.tracker.getLatestTemperature(2))[1]).to.equal(1n);
    });
  });
});
