// Custody transfer and provenance history tests (N4).
//
// Deploys contracts/test/CustodyTestHarness.sol: the full ProvenanceTracker plus three
// test-only helpers that freeze/unfreeze a batch without role checks. Switch deployCustody to
// the shared fixture (test/fixtures.js, A6) once it is on main.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

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

const role = (name) => ethers.id(`${name}_ROLE`);
const ONE_YEAR = 365 * 24 * 60 * 60;

async function deployCustody() {
  const [
    admin,
    manufacturer,
    distributor,
    carrier,
    pharmacy,
    regulator,
    oracle,
    stranger,
    distributor2,
  ] = await ethers.getSigners();

  const tracker = await ethers.deployContract("CustodyTestHarness");

  const participants = [
    [manufacturer, "MANUFACTURER", "Acme Pharma"],
    [distributor, "DISTRIBUTOR", "MedDistrib"],
    [distributor2, "DISTRIBUTOR", "SecondDistrib"],
    [carrier, "CARRIER", "ColdFreight"],
    [pharmacy, "PHARMACY", "CityCare Pharmacy"],
    [regulator, "REGULATOR", "Health Authority"],
    [oracle, "ORACLE", "Sensor Oracle"],
  ];
  for (const [signer, name, label] of participants) {
    await tracker.registerParticipant(signer.address, role(name), label);
  }

  const expiry = (await time.latest()) + ONE_YEAR;
  await tracker
    .connect(manufacturer)
    .registerBatch("Insulin 10ml", "LOT-001", expiry, ethers.ZeroHash);
  const batchId = 1n;
  // S4 team decision: a batch must be approved by a Regulator before its first shipment.
  await tracker.connect(regulator).approveBatch(batchId, ethers.id("cert-LOT-001"));

  return {
    tracker,
    batchId,
    expiry,
    admin,
    manufacturer,
    distributor,
    distributor2,
    carrier,
    pharmacy,
    regulator,
    oracle,
    stranger,
  };
}

/** Sends batch 1 from `from` to `to` and accepts it. */
async function handoff(tracker, batchId, from, to) {
  await tracker.connect(from).initiateTransfer(batchId, to.address);
  await tracker.connect(to).acceptTransfer(batchId);
}

describe("CustodyModule", function () {
  describe("initiateTransfer", function () {
    it("sets the pending custodian, moves the batch to InTransit and emits events", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);

      await expect(
        tracker
          .connect(manufacturer)
          .initiateTransfer(batchId, distributor.address),
      )
        .to.emit(tracker, "CustodyTransferInitiated")
        .withArgs(batchId, manufacturer.address, distributor.address)
        .and.to.emit(tracker, "StatusChanged")
        .withArgs(
          batchId,
          Status.Created,
          Status.InTransit,
          manufacturer.address,
        );

      const batch = await tracker.getBatch(batchId);
      expect(batch.status).to.equal(Status.InTransit);
      expect(batch.pendingCustodian).to.equal(distributor.address);
      expect(batch.currentCustodian).to.equal(manufacturer.address);
    });

    it("rejects a sender that is not the current custodian", async function () {
      const { tracker, batchId, distributor, carrier, stranger } =
        await loadFixture(deployCustody);

      for (const caller of [distributor, stranger]) {
        await expect(
          tracker.connect(caller).initiateTransfer(batchId, carrier.address),
        )
          .to.be.revertedWithCustomError(tracker, "NotCurrentCustodian")
          .withArgs(batchId, caller.address);
      }
    });

    it("rejects an unknown batch", async function () {
      const { tracker, manufacturer, distributor } =
        await loadFixture(deployCustody);

      await expect(
        tracker.connect(manufacturer).initiateTransfer(99, distributor.address),
      )
        .to.be.revertedWithCustomError(tracker, "UnknownBatch")
        .withArgs(99);
    });

    it("rejects the zero address, the sender itself and unregistered recipients", async function () {
      const { tracker, batchId, manufacturer, stranger } =
        await loadFixture(deployCustody);

      for (const to of [
        ethers.ZeroAddress,
        manufacturer.address,
        stranger.address,
      ]) {
        await expect(
          tracker.connect(manufacturer).initiateTransfer(batchId, to),
        )
          .to.be.revertedWithCustomError(tracker, "InvalidNextHop")
          .withArgs(batchId, to);
      }
    });

    it("rejects a second transfer while one is pending", async function () {
      const { tracker, batchId, manufacturer, distributor, carrier } =
        await loadFixture(deployCustody);

      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);
      await expect(
        tracker
          .connect(manufacturer)
          .initiateTransfer(batchId, carrier.address),
      )
        .to.be.revertedWithCustomError(tracker, "TransferAlreadyPending")
        .withArgs(batchId, distributor.address);
    });
  });

  describe("hop table", function () {
    // sender role -> recipient roles it may hand off to
    const ALLOWED = {
      manufacturer: ["distributor", "carrier"],
      distributor: ["carrier", "pharmacy"],
      carrier: ["distributor", "pharmacy"],
      pharmacy: [],
    };
    const RECIPIENTS = [
      "manufacturer",
      "distributor",
      "carrier",
      "pharmacy",
      "regulator",
      "oracle",
    ];

    // Gets the batch into `sender`'s custody through allowed hops only.
    const PATH_TO = {
      manufacturer: [],
      distributor: ["distributor"],
      carrier: ["carrier"],
      pharmacy: ["distributor", "pharmacy"],
    };

    for (const [sender, allowed] of Object.entries(ALLOWED)) {
      for (const recipient of RECIPIENTS) {
        if (recipient === sender) continue;
        const ok = allowed.includes(recipient);

        it(`${sender} -> ${recipient} is ${ok ? "allowed" : "rejected"}`, async function () {
          const f = await loadFixture(deployCustody);
          const { tracker, batchId } = f;

          let holder = f.manufacturer;
          for (const next of PATH_TO[sender]) {
            await handoff(tracker, batchId, holder, f[next]);
            holder = f[next];
          }

          const call = tracker
            .connect(holder)
            .initiateTransfer(batchId, f[recipient].address);
          if (ok) {
            await expect(call).to.emit(tracker, "CustodyTransferInitiated");
          } else {
            await expect(call).to.be.revertedWithCustomError(
              tracker,
              "InvalidNextHop",
            );
          }
        });
      }
    }

    it("allows a hop through any role an account holds", async function () {
      const { tracker, batchId, admin, manufacturer, stranger } =
        await loadFixture(deployCustody);

      // stranger is both a Carrier and a Regulator: Manufacturer -> Carrier is allowed.
      await tracker
        .connect(admin)
        .registerParticipant(stranger.address, role("REGULATOR"), "Dual");
      await tracker
        .connect(admin)
        .registerParticipant(stranger.address, role("CARRIER"), "Dual");

      await expect(
        tracker
          .connect(manufacturer)
          .initiateTransfer(batchId, stranger.address),
      ).to.emit(tracker, "CustodyTransferInitiated");
    });
  });

  describe("acceptTransfer", function () {
    it("moves custody, clears the pending custodian, moves to Received and emits events", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);

      await expect(tracker.connect(distributor).acceptTransfer(batchId))
        .to.emit(tracker, "CustodyTransferAccepted")
        .withArgs(batchId, manufacturer.address, distributor.address)
        .and.to.emit(tracker, "StatusChanged")
        .withArgs(
          batchId,
          Status.InTransit,
          Status.Received,
          distributor.address,
        );

      const batch = await tracker.getBatch(batchId);
      expect(batch.status).to.equal(Status.Received);
      expect(batch.currentCustodian).to.equal(distributor.address);
      expect(batch.pendingCustodian).to.equal(ethers.ZeroAddress);
    });

    it("rejects accept by a stranger, by the sender and by another valid participant", async function () {
      const {
        tracker,
        batchId,
        manufacturer,
        distributor,
        distributor2,
        stranger,
      } = await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);

      for (const caller of [stranger, manufacturer, distributor2]) {
        await expect(tracker.connect(caller).acceptTransfer(batchId))
          .to.be.revertedWithCustomError(tracker, "NotPendingCustodian")
          .withArgs(batchId, caller.address);
      }
    });

    it("rejects a double accept", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await handoff(tracker, batchId, manufacturer, distributor);

      await expect(tracker.connect(distributor).acceptTransfer(batchId))
        .to.be.revertedWithCustomError(tracker, "NoPendingTransfer")
        .withArgs(batchId);
    });

    it("rejects accept with nothing pending and for an unknown batch", async function () {
      const { tracker, batchId, distributor } =
        await loadFixture(deployCustody);

      await expect(tracker.connect(distributor).acceptTransfer(batchId))
        .to.be.revertedWithCustomError(tracker, "NoPendingTransfer")
        .withArgs(batchId);
      await expect(tracker.connect(distributor).acceptTransfer(99))
        .to.be.revertedWithCustomError(tracker, "UnknownBatch")
        .withArgs(99);
    });

    it("rejects accept by a recipient whose role was revoked after the transfer started", async function () {
      const { tracker, batchId, admin, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);
      await tracker.connect(admin).revokeParticipant(distributor.address);

      await expect(tracker.connect(distributor).acceptTransfer(batchId))
        .to.be.revertedWithCustomError(tracker, "InvalidNextHop")
        .withArgs(batchId, distributor.address);

      // The sender can still take the batch back.
      await tracker.connect(manufacturer).cancelTransfer(batchId);
      expect((await tracker.getBatch(batchId)).status).to.equal(Status.Created);
    });

    it("rejects accept when the sender's role was revoked after the transfer started", async function () {
      const { tracker, batchId, admin, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);
      await tracker.connect(admin).revokeParticipant(manufacturer.address);

      await expect(tracker.connect(distributor).acceptTransfer(batchId))
        .to.be.revertedWithCustomError(tracker, "InvalidNextHop")
        .withArgs(batchId, distributor.address);
      expect((await tracker.getBatch(batchId)).currentCustodian).to.equal(
        manufacturer.address,
      );
    });
  });

  describe("cancelTransfer", function () {
    it("returns the batch to Created, clears the pending custodian and emits events", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);

      await expect(tracker.connect(manufacturer).cancelTransfer(batchId))
        .to.emit(tracker, "CustodyTransferCancelled")
        .withArgs(batchId, manufacturer.address, distributor.address)
        .and.to.emit(tracker, "StatusChanged")
        .withArgs(
          batchId,
          Status.InTransit,
          Status.Created,
          manufacturer.address,
        );

      const batch = await tracker.getBatch(batchId);
      expect(batch.status).to.equal(Status.Created);
      expect(batch.currentCustodian).to.equal(manufacturer.address);
      expect(batch.pendingCustodian).to.equal(ethers.ZeroAddress);

      // The cancelled recipient can no longer accept, and the batch can be sent again.
      await expect(
        tracker.connect(distributor).acceptTransfer(batchId),
      ).to.be.revertedWithCustomError(tracker, "NoPendingTransfer");
      await expect(
        tracker
          .connect(manufacturer)
          .initiateTransfer(batchId, distributor.address),
      ).to.emit(tracker, "CustodyTransferInitiated");
    });

    it("returns the batch to exactly the status it held before the transfer", async function () {
      const { tracker, batchId, manufacturer, distributor, carrier, pharmacy } =
        await loadFixture(deployCustody);
      await handoff(tracker, batchId, manufacturer, distributor);

      // From Received.
      await tracker
        .connect(distributor)
        .initiateTransfer(batchId, carrier.address);
      await tracker.connect(distributor).cancelTransfer(batchId);
      expect((await tracker.getBatch(batchId)).status).to.equal(
        Status.Received,
      );

      // From Stored.
      await tracker.connect(distributor).markStored(batchId);
      await tracker
        .connect(distributor)
        .initiateTransfer(batchId, pharmacy.address);
      await tracker.connect(distributor).cancelTransfer(batchId);
      expect((await tracker.getBatch(batchId)).status).to.equal(Status.Stored);
    });

    it("only lets the sender cancel", async function () {
      const { tracker, batchId, manufacturer, distributor, stranger } =
        await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);

      for (const caller of [distributor, stranger]) {
        await expect(tracker.connect(caller).cancelTransfer(batchId))
          .to.be.revertedWithCustomError(tracker, "NotCurrentCustodian")
          .withArgs(batchId, caller.address);
      }
    });

    it("rejects a cancel with nothing pending", async function () {
      const { tracker, batchId, manufacturer } =
        await loadFixture(deployCustody);

      await expect(tracker.connect(manufacturer).cancelTransfer(batchId))
        .to.be.revertedWithCustomError(tracker, "NoPendingTransfer")
        .withArgs(batchId);
    });

    it("does not add a history record", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);
      await tracker.connect(manufacturer).cancelTransfer(batchId);

      expect(await tracker.getHistoryLength(batchId)).to.equal(0n);
    });
  });

  describe("frozen batches", function () {
    it("cannot be sent while Quarantined, and can after release", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker.harnessQuarantine(batchId);

      await expect(
        tracker
          .connect(manufacturer)
          .initiateTransfer(batchId, distributor.address),
      )
        .to.be.revertedWithCustomError(tracker, "InvalidTransition")
        .withArgs(batchId, Status.Quarantined, Status.InTransit);
      expect((await tracker.getBatch(batchId)).pendingCustodian).to.equal(
        ethers.ZeroAddress,
      );

      await tracker.harnessRelease(batchId);
      await expect(
        tracker
          .connect(manufacturer)
          .initiateTransfer(batchId, distributor.address),
      ).to.emit(tracker, "CustodyTransferInitiated");
    });

    it("cannot be accepted or cancelled while quarantined in transit; release restores both", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);
      await tracker.harnessQuarantine(batchId);

      await expect(tracker.connect(distributor).acceptTransfer(batchId))
        .to.be.revertedWithCustomError(tracker, "InvalidTransition")
        .withArgs(batchId, Status.Quarantined, Status.Received);
      await expect(tracker.connect(manufacturer).cancelTransfer(batchId))
        .to.be.revertedWithCustomError(tracker, "InvalidTransition")
        .withArgs(batchId, Status.Quarantined, Status.Created);

      // The pending handoff survives the quarantine and completes after release.
      await tracker.harnessRelease(batchId);
      expect((await tracker.getBatch(batchId)).status).to.equal(
        Status.InTransit,
      );
      await tracker.connect(distributor).acceptTransfer(batchId);
      expect((await tracker.getBatch(batchId)).currentCustodian).to.equal(
        distributor.address,
      );
    });

    it("cannot be sent, accepted or cancelled once Recalled", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .initiateTransfer(batchId, distributor.address);
      await tracker.harnessQuarantine(batchId);
      await tracker.harnessRecall(batchId);

      await expect(
        tracker.connect(distributor).acceptTransfer(batchId),
      ).to.be.revertedWithCustomError(tracker, "InvalidTransition");
      await expect(
        tracker.connect(manufacturer).cancelTransfer(batchId),
      ).to.be.revertedWithCustomError(tracker, "InvalidTransition");
      await expect(
        tracker
          .connect(manufacturer)
          .initiateTransfer(batchId, distributor.address),
      ).to.be.revertedWithCustomError(tracker, "TransferAlreadyPending");
      expect((await tracker.getBatch(batchId)).currentCustodian).to.equal(
        manufacturer.address,
      );
    });

    it("cannot be sent once Recalled with no transfer pending", async function () {
      const { tracker, batchId, manufacturer, distributor } =
        await loadFixture(deployCustody);
      await tracker.harnessQuarantine(batchId);
      await tracker.harnessRecall(batchId);

      await expect(
        tracker
          .connect(manufacturer)
          .initiateTransfer(batchId, distributor.address),
      )
        .to.be.revertedWithCustomError(tracker, "InvalidTransition")
        .withArgs(batchId, Status.Recalled, Status.InTransit);
    });

    it("cannot be sent once Dispensed", async function () {
      const {
        tracker,
        batchId,
        admin,
        manufacturer,
        distributor,
        pharmacy,
        carrier,
      } = await loadFixture(deployCustody);
      await handoff(tracker, batchId, manufacturer, distributor);
      await handoff(tracker, batchId, distributor, pharmacy);
      await tracker.connect(pharmacy).markStored(batchId);
      await tracker.connect(pharmacy).markDispensed(batchId);

      // Give the pharmacy a Distributor role too, so Pharmacy -> Carrier is an allowed hop
      // and only the Dispensed status can be what stops the transfer.
      await tracker
        .connect(admin)
        .registerParticipant(pharmacy.address, role("DISTRIBUTOR"), "Dual");

      await expect(
        tracker.connect(pharmacy).initiateTransfer(batchId, carrier.address),
      )
        .to.be.revertedWithCustomError(tracker, "InvalidTransition")
        .withArgs(batchId, Status.Dispensed, Status.InTransit);
    });
  });

  describe("provenance history", function () {
    it("is empty for a new batch and for an unknown ID", async function () {
      const { tracker, batchId } = await loadFixture(deployCustody);

      expect(await tracker.getCustodyHistory(batchId)).to.deep.equal([]);
      expect(await tracker.getHistoryLength(batchId)).to.equal(0n);
      expect(await tracker.getCustodyHistory(99)).to.deep.equal([]);
      expect(await tracker.getHistoryLength(99)).to.equal(0n);
    });

    it("records every accepted handoff in order with from, to, timestamp and status", async function () {
      const { tracker, batchId, manufacturer, distributor, carrier, pharmacy } =
        await loadFixture(deployCustody);

      const hops = [
        [manufacturer, distributor],
        [distributor, carrier],
        [carrier, pharmacy],
      ];
      const times = [];
      for (const [from, to] of hops) {
        await handoff(tracker, batchId, from, to);
        times.push(BigInt(await time.latest()));
      }

      const history = await tracker.getCustodyHistory(batchId);
      expect(history.length).to.equal(3);
      expect(await tracker.getHistoryLength(batchId)).to.equal(3n);

      history.forEach((record, i) => {
        expect(record.from).to.equal(hops[i][0].address);
        expect(record.to).to.equal(hops[i][1].address);
        expect(record.timestamp).to.equal(times[i]);
        expect(record.statusAfter).to.equal(Status.Received);
      });

      // Later status changes do not rewrite past records.
      await tracker.connect(pharmacy).markStored(batchId);
      await tracker.connect(pharmacy).markDispensed(batchId);
      const after = await tracker.getCustodyHistory(batchId);
      expect(after.map((r) => r.statusAfter)).to.deep.equal([
        Status.Received,
        Status.Received,
        Status.Received,
      ]);
    });

    it("keeps each batch's history separate", async function () {
      const {
        tracker,
        batchId,
        expiry,
        manufacturer,
        distributor,
        carrier,
        regulator,
      } = await loadFixture(deployCustody);
      await tracker
        .connect(manufacturer)
        .registerBatch("Vaccine", "LOT-002", expiry, ethers.ZeroHash);
      await tracker.connect(regulator).approveBatch(2n, ethers.id("cert-LOT-002"));

      await handoff(tracker, batchId, manufacturer, distributor);
      await handoff(tracker, 2n, manufacturer, carrier);

      const one = await tracker.getCustodyHistory(batchId);
      const two = await tracker.getCustodyHistory(2n);
      expect(one.map((r) => r.to)).to.deep.equal([distributor.address]);
      expect(two.map((r) => r.to)).to.deep.equal([carrier.address]);
    });
  });

  it("runs a full journey: manufacturer to pharmacy, dispensed", async function () {
    const { tracker, batchId, manufacturer, distributor, carrier, pharmacy } =
      await loadFixture(deployCustody);

    await handoff(tracker, batchId, manufacturer, distributor);
    await tracker.connect(distributor).markStored(batchId);
    await handoff(tracker, batchId, distributor, carrier);
    await handoff(tracker, batchId, carrier, pharmacy);
    await tracker.connect(pharmacy).markStored(batchId);
    await tracker.connect(pharmacy).markDispensed(batchId);

    const batch = await tracker.getBatch(batchId);
    expect(batch.status).to.equal(Status.Dispensed);
    expect(batch.currentCustodian).to.equal(pharmacy.address);
    expect(await tracker.getHistoryLength(batchId)).to.equal(3n);
  });
});
