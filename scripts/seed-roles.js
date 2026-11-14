// Grants the six participant roles to demo accounts, against whichever deployment
// deployments/<network>.json records. Run after scripts/deploy.js:
//
//   npx hardhat run scripts/seed-roles.js --network localhost
//   npx hardhat run scripts/seed-roles.js --network amoy
//
// On "localhost" / "hardhat", seeds the next six default signers (no address configuration
// needed, since that mnemonic is the same for everyone and holds no real funds). On any other
// network, reads public addresses from deployments/demo-accounts.json — see
// deployments/README.md for the expected format. Never put a private key in that file.

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const ROLE_NAMES = ["MANUFACTURER", "DISTRIBUTOR", "CARRIER", "PHARMACY", "REGULATOR", "ORACLE"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadDemoAccounts(network) {
  const file = path.join(__dirname, "..", "deployments", "demo-accounts.json");
  if (!fs.existsSync(file)) {
    throw new Error(`Missing ${file}. See deployments/README.md for the expected format.`);
  }
  const all = readJson(file);
  const forNetwork = all[network];
  if (!forNetwork) {
    throw new Error(`No demo accounts configured for network "${network}" in ${file}.`);
  }
  return forNetwork;
}

async function localAccounts() {
  // Signers [1..6]: signer [0] is the deployer/admin, matching scripts/deploy.js.
  const signers = await hre.ethers.getSigners();
  return {
    MANUFACTURER: { address: signers[1].address, name: "Acme Pharma" },
    DISTRIBUTOR: { address: signers[2].address, name: "MedDistrib" },
    CARRIER: { address: signers[3].address, name: "ColdFreight" },
    PHARMACY: { address: signers[4].address, name: "CityCare Pharmacy" },
    REGULATOR: { address: signers[5].address, name: "Health Authority" },
    ORACLE: { address: signers[6].address, name: "Sensor Oracle" },
  };
}

async function main() {
  const network = hre.network.name;
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found for "${network}". Run scripts/deploy.js first.`);
  }
  const { address } = readJson(deploymentFile);

  const tracker = await hre.ethers.getContractAt("ProvenanceTracker", address);
  const [admin] = await hre.ethers.getSigners();

  const accountsByRole =
    network === "localhost" || network === "hardhat"
      ? await localAccounts()
      : loadDemoAccounts(network);

  for (const roleName of ROLE_NAMES) {
    const entry = accountsByRole[roleName];
    if (!entry || !entry.address) {
      console.log(`Skipping ${roleName}: no address configured.`);
      continue;
    }

    const role = hre.ethers.id(`${roleName}_ROLE`);
    if (await tracker.hasRole(role, entry.address)) {
      console.log(`${roleName} already registered for ${entry.address}, skipping.`);
      continue;
    }

    const tx = await tracker.connect(admin).registerParticipant(
      entry.address,
      role,
      entry.name || roleName
    );
    await tx.wait();
    console.log(`Registered ${roleName} (${entry.name || ""}) -> ${entry.address}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
