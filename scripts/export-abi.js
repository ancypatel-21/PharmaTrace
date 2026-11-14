// Copies the deployed address + compiled ABI into web/src/contracts/ and simulator/config/,
// in the combined format web/src/lib/config.js expects: { network, chainId, address, abi }.
// Run after scripts/deploy.js, and re-run any time a contract function/event signature changes:
//
//   npx hardhat run scripts/export-abi.js --network localhost
//   npx hardhat run scripts/export-abi.js --network amoy

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const network = hre.network.name;
  const deploymentFile = path.join(__dirname, "..", "deployments", `${network}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`No deployment found for "${network}". Run scripts/deploy.js first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));

  const artifact = await hre.artifacts.readArtifact("ProvenanceTracker");
  const exportData = {
    network,
    chainId: deployment.chainId,
    address: deployment.address,
    abi: artifact.abi,
  };
  const contents = `${JSON.stringify(exportData, null, 2)}\n`;

  const targets = [
    path.join(__dirname, "..", "web", "src", "contracts", `${network}.json`),
    path.join(__dirname, "..", "simulator", "config", `${network}.json`),
  ];

  for (const target of targets) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    console.log(`Wrote ${path.relative(path.join(__dirname, ".."), target)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
