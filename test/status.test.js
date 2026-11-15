// Status state machine tests (S5): the full from/to transition matrix enforced by
// _changeStatus (S2), the approval gate on the first shipment (S4), the notFrozen modifier and
// the quarantine hook (S3), and the public markStored / markDispensed functions.
//
// The matrix uses contracts/test/StatusTestHarness.sol, which exposes the real internal
// _changeStatus so every pair can be tried directly. markStored / markDispensed are tested on
// the real ProvenanceTracker through the shared fixture (A6).

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
const ALL = Object.keys(Status);
const ONE_YEAR = 365 * 24 * 60 * 60;
const CERT = ethers.id("certificate.pdf");

// ---------------------------------------------------------------------------
// Harness fixture: real ProvenanceTracker + exposed _changeStatus.
// ---------------------------------------------------------------------------

async function deployHarness() {
  const [admin, manufacturer, regulator, stranger] = await ethers.getSigners();
  const tracker = await ethers.deployContract("StatusTestHarness");
  await tracker.registerParticipant(manufacturer.address, role("MANUFACTURER"), "Acme Pharma");
  await tracker.registerParticipant(regulator.address, role("REGULATOR"), "Health Authority");
  const expiry = (await time.latest()) + ONE_YEAR;
  return { tracker, admin, manufacturer, regulator, stranger, expiry };
}

let lot = 0;

/**
 * Registers a batch, optionally approves it, and walks it through `path` with the real
 * _changeStatus. Returns the new batch ID.
 */
async function batchAt(f, path, { approve = true } = {}) {
  const { tracker, manufacturer, regulator, expiry } = f;
  await tracker
    .connect(manufacturer)
    .registerBatch("Insulin 10ml", `LOT-${++lot}`, expiry, ethers.ZeroHash);
  const id = await tracker.totalBatches();
  if (approve) await tracker.connect(regulator).approveBatch(id, CERT);
  for (const s of path) await tracker.exposedChangeStatus(id, Status[s]);
  return id;
}

// Each starting point: how to reach it, and which target statuses are allowed from it.
// InTransit and Quarantined appear several times because what they may move to depends on
// the status recorded before entering them.
const START_POINTS = [
  {
    name: "Created",
    path: [],
    allowed: ["InTransit", "Quarantined"],
  },
  {
    name: "InTransit (sent from Created)",
    path: ["InTransit"],
    allowed: ["Received", "Quarantined", "Created"],
  },
  {
    name: "InTransit (sent from Received)",
    path: ["InTransit", "Received", "InTransit"],
    allowed: ["Received", "Quarantined"],
  },
  {
    name: "InTransit (sent from Stored)",
    path: ["InTransit", "Received", "Stored", "InTransit"],
    allowed: ["Received", "Quarantined", "Stored"],
  },
  {
    name: "Received",
    path: ["InTransit", "Received"],
    allowed: ["Stored", "InTransit", "Quarantined"],
  },
  {
    name: "Stored",
    path: ["InTransit", "Received", "Stored"],
    allowed: ["InTransit", "Dispensed", "Quarantined"],
  },
  {
    name: "Dispensed",
    path: ["InTransit", "Received", "Stored", "Dispensed"],
    allowed: [],
  },
  {
    name: "Quarantined (from Created)",
    path: ["Quarantined"],
    allowed: ["Created", "Recalled"],
  },
  {
    name: "Quarantined (from InTransit)",
    path: ["InTransit", "Quarantined"],
    allowed: ["InTransit", "Recalled"],
  },
  {
    name: "Quarantined (from Received)",
    path: ["InTransit", "Received", "Quarantined"],
    allowed: ["Received", "Recalled"],
  },
  {
    name: "Quarantined (from Stored)",
    path: ["InTransit", "Received", "Stored", "Quarantined"],
    allowed: ["Stored", "Recalled"],
  },
  {
    name: "Recalled",
    path: ["Quarantined", "Recalled"],
    allowed: [],
  },
];

describe("Status state machine (S5)", function () {
  describe("transition matrix: every from/to pair", function () {
    for (const start of START_POINTS) {
      const from = start.path.length ? start.path[start.path.length - 1] : "Created";

      describe(`from ${start.name}`, function () {
        for (const to of ALL) {
          const ok = start.allowed.includes(to);

          it(`-> ${to} is ${ok ? "allowed" : "rejected"}`, async function () {
            const f = await loadFixture(deployHarness);
            const id = await batchAt(f, start.path);
            const call = f.tracker.exposedChangeStatus(id, Status[to]);

            if (ok) {
              await expect(call)
                .to.emit(f.tracker, "StatusChanged")
                .withArgs(id, Status[from], Status[to], f.admin.address);
              expect((await f.tracker.getBatch(id)).status).to.equal(Status[to]);
            } else {
              await expect(call)
                .to.be.revertedWithCustomError(f.tracker, "InvalidTransition")
                .withArgs(id, Status[from], Status[to]);
            }
          });
        }
      });
    }
  });

  describe("approval gate (S4)", function () {
    it("rejects Created -> InTransit until the batch is approved", async function () {
      const f = await loadFixture(deployHarness);
      const id = await batchAt(f, [], { approve: false });

      await expect(f.tracker.exposedChangeStatus(id, Status.InTransit))
        .to.be.revertedWithCustomError(f.tracker, "NotApproved")
        .withArgs(id);

      await f.tracker.connect(f.regulator).approveBatch(id, CERT);
      await expect(f.tracker.exposedChangeStatus(id, Status.InTransit)).to.emit(
        f.tracker,
        "StatusChanged",
      );
    });

    it("still lets an unapproved batch be quarantined and recalled", async function () {
      const f = await loadFixture(deployHarness);
      const id = await batchAt(f, ["Quarantined", "Recalled"], { approve: false });
      expect((await f.tracker.getBatch(id)).status).to.equal(Status.Recalled);
    });

    it("needs approval again after a quarantine release back to Created", async function () {
      const f = await loadFixture(deployHarness);
      const id = await batchAt(f, ["Quarantined", "Created"], { approve: false });
      await expect(
        f.tracker.exposedChangeStatus(id, Status.InTransit),
      ).to.be.revertedWithCustomError(f.tracker, "NotApproved");
    });
  });

  describe("recorded previous statuses", function () {
    it("a batch quarantined in transit, then released, can still be cancelled to its pre-transit status", async function () {
      const f = await loadFixture(deployHarness);
      const id = await batchAt(f, [
        "InTransit",
        "Received",
        "Stored",
        "InTransit",
        "Quarantined",
        "InTransit",
      ]);

      await expect(
        f.tracker.exposedChangeStatus(id, Status.Created),
      ).to.be.revertedWithCustomError(f.tracker, "InvalidTransition");
      await f.tracker.exposedChangeStatus(id, Status.Stored);
      expect((await f.tracker.getBatch(id)).status).to.equal(Status.Stored);
    });

    it("each new quarantine records the latest previous status", async function () {
      const f = await loadFixture(deployHarness);
      const id = await batchAt(f, ["Quarantined", "Created", "InTransit", "Quarantined"]);

      await expect(
        f.tracker.exposedChangeStatus(id, Status.Created),
      ).to.be.revertedWithCustomError(f.tracker, "InvalidTransition");
      await f.tracker.exposedChangeStatus(id, Status.InTransit);
    });
  });

  describe("unknown batches", function () {
    it("_changeStatus reverts with UnknownBatch", async function () {
      const { tracker } = await loadFixture(deployHarness);
      for (const id of [0n, 99n]) {
        await expect(tracker.exposedChangeStatus(id, Status.InTransit))
          .to.be.revertedWithCustomError(tracker, "UnknownBatch")
          .withArgs(id);
      }
    });
  });

  describe("notFrozen modifier", function () {
    const cases = [
      ["Created", [], false],
      ["InTransit", ["InTransit"], false],
      ["Received", ["InTransit", "Received"], false],
      ["Stored", ["InTransit", "Received", "Stored"], false],
      ["Dispensed", ["InTransit", "Received", "Stored", "Dispensed"], true],
      ["Quarantined", ["Quarantined"], true],
      ["Recalled", ["Quarantined", "Recalled"], true],
    ];

    for (const [name, path, frozen] of cases) {
      it(`${frozen ? "blocks" : "allows"} a ${name} batch`, async function () {
        const f = await loadFixture(deployHarness);
        const id = await batchAt(f, path);
        if (frozen) {
          await expect(f.tracker.exposedNotFrozen(id))
            .to.be.revertedWithCustomError(f.tracker, "BatchFrozen")
            .withArgs(id, Status[name]);
        } else {
          expect(await f.tracker.exposedNotFrozen(id)).to.equal(true);
        }
      });
    }

    it("reverts with UnknownBatch for an unknown ID", async function () {
      const { tracker } = await loadFixture(deployHarness);
      await expect(tracker.exposedNotFrozen(42)).to.be.revertedWithCustomError(
        tracker,
        "UnknownBatch",
      );
    });
  });

  describe("_quarantine hook (oracle path)", function () {
    it("quarantines and emits BatchQuarantined with the previous status", async function () {
      const f = await loadFixture(deployHarness);
      const id = await batchAt(f, ["InTransit", "Received", "Stored"]);
      await expect(f.tracker.exposedQuarantine(id, "Temperature excursion"))
        .to.emit(f.tracker, "BatchQuarantined")
        .withArgs(id, "Temperature excursion", Status.Stored);
      expect((await f.tracker.getBatch(id)).status).to.equal(Status.Quarantined);
    });

    it("rejects terminal and already-quarantined batches, and unknown IDs", async function () {
      const f = await loadFixture(deployHarness);
      for (const path of [
        ["Quarantined"],
        ["Quarantined", "Recalled"],
        ["InTransit", "Received", "Stored", "Dispensed"],
      ]) {
        const id = await batchAt(f, path);
        await expect(f.tracker.exposedQuarantine(id, "x")).to.be.revertedWithCustomError(
          f.tracker,
          "InvalidTransition",
        );
      }
      await expect(f.tracker.exposedQuarantine(99, "x")).to.be.revertedWithCustomError(
        f.tracker,
        "UnknownBatch",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Public status functions on the real ProvenanceTracker (shared fixture).
  // -------------------------------------------------------------------------

  async function deployReal() {
    const f = await deployWithParticipants();
    const expiry = (await time.latest()) + ONE_YEAR;
    await f.tracker
      .connect(f.manufacturer)
      .registerBatch("Insulin 10ml", "LOT-REAL", expiry, ethers.ZeroHash);
    await f.tracker.connect(f.regulator).approveBatch(1n, CERT);
    return { ...f, id: 1n };
  }

  async function handoff(tracker, id, from, to) {
    await tracker.connect(from).initiateTransfer(id, to.address);
    await tracker.connect(to).acceptTransfer(id);
  }

  describe("markStored", function () {
    it("lets the current custodian store a Received batch", async function () {
      const { tracker, id, manufacturer, distributor } = await loadFixture(deployReal);
      await handoff(tracker, id, manufacturer, distributor);

      await expect(tracker.connect(distributor).markStored(id))
        .to.emit(tracker, "StatusChanged")
        .withArgs(id, Status.Received, Status.Stored, distributor.address);
      expect((await tracker.getBatch(id)).status).to.equal(Status.Stored);
    });

    it("rejects anyone but the current custodian", async function () {
      const { tracker, id, manufacturer, distributor, regulator, others } =
        await loadFixture(deployReal);
      await handoff(tracker, id, manufacturer, distributor);

      for (const caller of [manufacturer, regulator, others[0]]) {
        await expect(tracker.connect(caller).markStored(id))
          .to.be.revertedWithCustomError(tracker, "NotCurrentCustodian")
          .withArgs(id, caller.address);
      }
    });

    it("rejects statuses other than Received", async function () {
      const { tracker, id, manufacturer, distributor } = await loadFixture(deployReal);

      // Created
      await expect(tracker.connect(manufacturer).markStored(id)).to.be.revertedWithCustomError(
        tracker,
        "InvalidTransition",
      );
      // Stored -> Stored
      await handoff(tracker, id, manufacturer, distributor);
      await tracker.connect(distributor).markStored(id);
      await expect(tracker.connect(distributor).markStored(id)).to.be.revertedWithCustomError(
        tracker,
        "InvalidTransition",
      );
    });

    it("rejects an unknown batch", async function () {
      const { tracker, manufacturer } = await loadFixture(deployReal);
      await expect(tracker.connect(manufacturer).markStored(99))
        .to.be.revertedWithCustomError(tracker, "UnknownBatch")
        .withArgs(99);
    });
  });

  describe("markDispensed", function () {
    async function atPharmacy(f, { store = true } = {}) {
      const { tracker, id, manufacturer, distributor, pharmacy } = f;
      await handoff(tracker, id, manufacturer, distributor);
      await handoff(tracker, id, distributor, pharmacy);
      if (store) await tracker.connect(pharmacy).markStored(id);
    }

    it("lets the Pharmacy custodian dispense a Stored batch (terminal)", async function () {
      const f = await loadFixture(deployReal);
      await atPharmacy(f);

      await expect(f.tracker.connect(f.pharmacy).markDispensed(f.id))
        .to.emit(f.tracker, "StatusChanged")
        .withArgs(f.id, Status.Stored, Status.Dispensed, f.pharmacy.address);

      await expect(
        f.tracker.connect(f.pharmacy).markDispensed(f.id),
      ).to.be.revertedWithCustomError(f.tracker, "InvalidTransition");
      await expect(
        f.tracker.connect(f.pharmacy).markStored(f.id),
      ).to.be.revertedWithCustomError(f.tracker, "InvalidTransition");
    });

    it("rejects a custodian without the Pharmacy role", async function () {
      const { tracker, id, manufacturer, distributor } = await loadFixture(deployReal);
      await handoff(tracker, id, manufacturer, distributor);
      await tracker.connect(distributor).markStored(id);

      await expect(tracker.connect(distributor).markDispensed(id))
        .to.be.revertedWithCustomError(tracker, "AccessControlUnauthorizedAccount")
        .withArgs(distributor.address, role("PHARMACY"));
    });

    it("rejects a Pharmacy that is not the custodian", async function () {
      const { tracker, id, manufacturer, distributor, pharmacy } =
        await loadFixture(deployReal);
      await handoff(tracker, id, manufacturer, distributor);
      await tracker.connect(distributor).markStored(id);

      await expect(tracker.connect(pharmacy).markDispensed(id))
        .to.be.revertedWithCustomError(tracker, "NotCurrentCustodian")
        .withArgs(id, pharmacy.address);
    });

    it("rejects dispensing a batch that was received but not stored", async function () {
      const f = await loadFixture(deployReal);
      await atPharmacy(f, { store: false });

      await expect(f.tracker.connect(f.pharmacy).markDispensed(f.id))
        .to.be.revertedWithCustomError(f.tracker, "InvalidTransition")
        .withArgs(f.id, Status.Received, Status.Dispensed);
    });
  });
});
