const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { role, deployWithParticipants } = require("./fixtures");

const ONE_YEAR = 365 * 24 * 60 * 60;

describe("BatchRegistry", function () {
  describe("registerBatch", function () {
    it("registers a batch with ID 1, the expected initial state, and emits BatchRegistered", async function () {
      const { tracker, manufacturer } = await loadFixture(deployWithParticipants);
      const expiry = (await time.latest()) + ONE_YEAR;
      const certHash = ethers.id("cert-LOT-001");

      await expect(
        tracker.connect(manufacturer).registerBatch("Insulin 10ml", "LOT-001", expiry, certHash)
      )
        .to.emit(tracker, "BatchRegistered")
        .withArgs(1n, manufacturer.address, "LOT-001");

      const batch = await tracker.getBatch(1);
      expect(batch.id).to.equal(1n);
      expect(batch.productName).to.equal("Insulin 10ml");
      expect(batch.lotNumber).to.equal("LOT-001");
      expect(batch.expiryDate).to.equal(BigInt(expiry));
      expect(batch.manufacturer).to.equal(manufacturer.address);
      expect(batch.currentCustodian).to.equal(manufacturer.address);
      expect(batch.pendingCustodian).to.equal(ethers.ZeroAddress);
      expect(batch.status).to.equal(0n); // Status.Created
      expect(batch.approved).to.equal(false);
      expect(batch.certificateHash).to.equal(certHash);
    });

    it("increments batch IDs across registrations", async function () {
      const { tracker, manufacturer } = await loadFixture(deployWithParticipants);
      const expiry = (await time.latest()) + ONE_YEAR;

      await tracker
        .connect(manufacturer)
        .registerBatch("Insulin 10ml", "LOT-001", expiry, ethers.ZeroHash);
      await tracker
        .connect(manufacturer)
        .registerBatch("Insulin 10ml", "LOT-002", expiry, ethers.ZeroHash);

      expect(await tracker.totalBatches()).to.equal(2n);
      expect(await tracker.batchExists(1)).to.equal(true);
      expect(await tracker.batchExists(2)).to.equal(true);
      expect(await tracker.batchExists(3)).to.equal(false);
    });

    it("reverts if called by a non-manufacturer", async function () {
      const { tracker, distributor } = await loadFixture(deployWithParticipants);
      const expiry = (await time.latest()) + ONE_YEAR;

      await expect(
        tracker
          .connect(distributor)
          .registerBatch("Insulin 10ml", "LOT-001", expiry, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(tracker, "AccessControlUnauthorizedAccount");
    });

    it("reverts on an empty product name or lot number", async function () {
      const { tracker, manufacturer } = await loadFixture(deployWithParticipants);
      const expiry = (await time.latest()) + ONE_YEAR;

      await expect(
        tracker.connect(manufacturer).registerBatch("", "LOT-001", expiry, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(tracker, "EmptyField");

      await expect(
        tracker.connect(manufacturer).registerBatch("Insulin 10ml", "", expiry, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(tracker, "EmptyField");
    });

    it("reverts on an expiry date that is not strictly in the future", async function () {
      const { tracker, manufacturer } = await loadFixture(deployWithParticipants);
      const now = await time.latest();

      await expect(
        tracker.connect(manufacturer).registerBatch("Insulin 10ml", "LOT-001", now, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(tracker, "ExpiryInPast");

      await expect(
        tracker
          .connect(manufacturer)
          .registerBatch("Insulin 10ml", "LOT-002", now - 1, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(tracker, "ExpiryInPast");
    });

    it("reverts on a duplicate lot number from the same manufacturer", async function () {
      const { tracker, manufacturer } = await loadFixture(deployWithParticipants);
      const expiry = (await time.latest()) + ONE_YEAR;

      await tracker
        .connect(manufacturer)
        .registerBatch("Insulin 10ml", "LOT-001", expiry, ethers.ZeroHash);

      await expect(
        tracker
          .connect(manufacturer)
          .registerBatch("Insulin 10ml", "LOT-001", expiry, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(tracker, "DuplicateLot");
    });

    it("allows the same lot number from two different manufacturers", async function () {
      const { tracker, admin, manufacturer, others } = await loadFixture(deployWithParticipants);
      const expiry = (await time.latest()) + ONE_YEAR;
      const manufacturer2 = others[0];

      await tracker
        .connect(admin)
        .registerParticipant(manufacturer2.address, role("MANUFACTURER"), "Second Pharma");

      await tracker
        .connect(manufacturer)
        .registerBatch("Insulin 10ml", "LOT-001", expiry, ethers.ZeroHash);

      await expect(
        tracker
          .connect(manufacturer2)
          .registerBatch("Insulin 10ml", "LOT-001", expiry, ethers.ZeroHash)
      ).to.not.be.reverted;
    });
  });

  describe("getBatch / batchExists / totalBatches", function () {
    it("reverts getBatch for an unknown ID", async function () {
      const { tracker } = await loadFixture(deployWithParticipants);

      await expect(tracker.getBatch(1)).to.be.revertedWithCustomError(tracker, "UnknownBatch");
    });

    it("reports batchExists false and totalBatches 0 before any registration", async function () {
      const { tracker } = await loadFixture(deployWithParticipants);

      expect(await tracker.batchExists(1)).to.equal(false);
      expect(await tracker.totalBatches()).to.equal(0n);
    });
  });
});
