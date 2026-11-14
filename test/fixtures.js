// Shared test fixture: deploys the real ProvenanceTracker and gives each of the six
// participant roles a signer. Reused across test files so every suite deploys and registers
// participants the same way.

const { ethers } = require("hardhat");

const ROLE_NAMES = ["MANUFACTURER", "DISTRIBUTOR", "CARRIER", "PHARMACY", "REGULATOR", "ORACLE"];

/** keccak256("<NAME>_ROLE"), matching the role constants declared in AccessRoles.sol. */
function role(name) {
  return ethers.id(`${name}_ROLE`);
}

/** Deploys a fresh ProvenanceTracker. No participants are registered yet. */
async function deployProvenanceTracker() {
  const [admin, manufacturer, distributor, carrier, pharmacy, regulator, oracle, ...others] =
    await ethers.getSigners();

  const tracker = await ethers.deployContract("ProvenanceTracker");

  return {
    tracker,
    admin,
    manufacturer,
    distributor,
    carrier,
    pharmacy,
    regulator,
    oracle,
    others,
  };
}

/** Deploys ProvenanceTracker and registers one signer for each of the six participant roles. */
async function deployWithParticipants() {
  const fixture = await deployProvenanceTracker();
  const { tracker, admin, manufacturer, distributor, carrier, pharmacy, regulator, oracle } =
    fixture;

  const signerByRole = {
    MANUFACTURER: manufacturer,
    DISTRIBUTOR: distributor,
    CARRIER: carrier,
    PHARMACY: pharmacy,
    REGULATOR: regulator,
    ORACLE: oracle,
  };
  const nameByRole = {
    MANUFACTURER: "Acme Pharma",
    DISTRIBUTOR: "MedDistrib",
    CARRIER: "ColdFreight",
    PHARMACY: "CityCare Pharmacy",
    REGULATOR: "Health Authority",
    ORACLE: "Sensor Oracle",
  };

  for (const name of ROLE_NAMES) {
    await tracker
      .connect(admin)
      .registerParticipant(signerByRole[name].address, role(name), nameByRole[name]);
  }

  return fixture;
}

module.exports = { ROLE_NAMES, role, deployProvenanceTracker, deployWithParticipants };
