const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { role, deployProvenanceTracker, deployWithParticipants } = require("./fixtures");

describe("AccessRoles", function () {
  describe("registerParticipant", function () {
    it("lets the admin register a participant and emits ParticipantRegistered", async function () {
      const { tracker, admin, manufacturer } = await loadFixture(deployProvenanceTracker);

      await expect(
        tracker
          .connect(admin)
          .registerParticipant(manufacturer.address, role("MANUFACTURER"), "Acme Pharma")
      )
        .to.emit(tracker, "ParticipantRegistered")
        .withArgs(manufacturer.address, role("MANUFACTURER"), "Acme Pharma");

      expect(await tracker.hasRole(role("MANUFACTURER"), manufacturer.address)).to.equal(true);
      expect(await tracker.participantName(manufacturer.address)).to.equal("Acme Pharma");
    });

    it("registers each of the six participant roles", async function () {
      const { tracker, admin, manufacturer, distributor, carrier, pharmacy, regulator, oracle } =
        await loadFixture(deployProvenanceTracker);

      const assignments = [
        [manufacturer, "MANUFACTURER"],
        [distributor, "DISTRIBUTOR"],
        [carrier, "CARRIER"],
        [pharmacy, "PHARMACY"],
        [regulator, "REGULATOR"],
        [oracle, "ORACLE"],
      ];

      for (const [signer, name] of assignments) {
        await tracker.connect(admin).registerParticipant(signer.address, role(name), name);
        expect(await tracker.hasRole(role(name), signer.address)).to.equal(true);
      }
    });

    it("reverts if called by a non-admin", async function () {
      const { tracker, manufacturer, distributor } = await loadFixture(deployProvenanceTracker);

      await expect(
        tracker
          .connect(distributor)
          .registerParticipant(manufacturer.address, role("MANUFACTURER"), "Acme Pharma")
      ).to.be.revertedWithCustomError(tracker, "AccessControlUnauthorizedAccount");
    });

    it("reverts on the zero address", async function () {
      const { tracker, admin } = await loadFixture(deployProvenanceTracker);

      await expect(
        tracker
          .connect(admin)
          .registerParticipant(ethers.ZeroAddress, role("MANUFACTURER"), "Acme Pharma")
      ).to.be.revertedWithCustomError(tracker, "ZeroAddress");
    });

    it("reverts on a role that is not one of the six participant roles", async function () {
      const { tracker, admin, manufacturer } = await loadFixture(deployProvenanceTracker);

      // DEFAULT_ADMIN_ROLE is bytes32(0) in OpenZeppelin AccessControl, and must not be
      // grantable through registerParticipant.
      await expect(
        tracker
          .connect(admin)
          .registerParticipant(manufacturer.address, ethers.ZeroHash, "Acme Pharma")
      ).to.be.revertedWithCustomError(tracker, "InvalidParticipantRole");
    });

    it("reverts on a duplicate registration of the same role", async function () {
      const { tracker, admin, manufacturer } = await loadFixture(deployProvenanceTracker);

      await tracker
        .connect(admin)
        .registerParticipant(manufacturer.address, role("MANUFACTURER"), "Acme Pharma");

      await expect(
        tracker
          .connect(admin)
          .registerParticipant(manufacturer.address, role("MANUFACTURER"), "Acme Pharma Again")
      ).to.be.revertedWithCustomError(tracker, "AlreadyRegistered");
    });

    it("lets one account hold more than one role", async function () {
      const { tracker, admin, manufacturer } = await loadFixture(deployProvenanceTracker);

      await tracker
        .connect(admin)
        .registerParticipant(manufacturer.address, role("MANUFACTURER"), "Acme Pharma");
      await tracker
        .connect(admin)
        .registerParticipant(manufacturer.address, role("DISTRIBUTOR"), "Acme Pharma");

      expect(await tracker.hasRole(role("MANUFACTURER"), manufacturer.address)).to.equal(true);
      expect(await tracker.hasRole(role("DISTRIBUTOR"), manufacturer.address)).to.equal(true);
    });
  });

  describe("revokeParticipant", function () {
    it("revokes the role and clears the stored name", async function () {
      const { tracker, admin, manufacturer } = await loadFixture(deployWithParticipants);

      await tracker.connect(admin).revokeParticipant(manufacturer.address);

      expect(await tracker.hasRole(role("MANUFACTURER"), manufacturer.address)).to.equal(false);
      expect(await tracker.participantName(manufacturer.address)).to.equal("");
    });

    it("revokes every role an account holds", async function () {
      const { tracker, admin, manufacturer } = await loadFixture(deployProvenanceTracker);

      await tracker
        .connect(admin)
        .registerParticipant(manufacturer.address, role("MANUFACTURER"), "Acme Pharma");
      await tracker
        .connect(admin)
        .registerParticipant(manufacturer.address, role("DISTRIBUTOR"), "Acme Pharma");

      await tracker.connect(admin).revokeParticipant(manufacturer.address);

      expect(await tracker.hasRole(role("MANUFACTURER"), manufacturer.address)).to.equal(false);
      expect(await tracker.hasRole(role("DISTRIBUTOR"), manufacturer.address)).to.equal(false);
    });

    it("reverts if called by a non-admin", async function () {
      const { tracker, distributor, manufacturer } = await loadFixture(deployWithParticipants);

      await expect(
        tracker.connect(distributor).revokeParticipant(manufacturer.address)
      ).to.be.revertedWithCustomError(tracker, "AccessControlUnauthorizedAccount");
    });

    it("reverts if the account holds no participant role", async function () {
      const { tracker, admin, others } = await loadFixture(deployProvenanceTracker);
      const stranger = others[0];

      await expect(
        tracker.connect(admin).revokeParticipant(stranger.address)
      ).to.be.revertedWithCustomError(tracker, "NotRegistered");
    });

    it("lets a revoked participant be re-registered", async function () {
      const { tracker, admin, manufacturer } = await loadFixture(deployWithParticipants);

      await tracker.connect(admin).revokeParticipant(manufacturer.address);

      await expect(
        tracker
          .connect(admin)
          .registerParticipant(manufacturer.address, role("MANUFACTURER"), "Acme Pharma Again")
      ).to.not.be.reverted;
      expect(await tracker.participantName(manufacturer.address)).to.equal("Acme Pharma Again");
    });
  });
});
