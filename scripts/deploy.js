// Deploys ProvenanceTracker to the selected network and records the result in
// deployments/<network>.json. Run against a persistent node (e.g. `npx hardhat node`, network
// "localhost") or against "amoy" once AMOY_RPC_URL and DEPLOYER_PRIVATE_KEY are set in .env.
//
//   npx hardhat run scripts/deploy.js --network localhost
//   npx hardhat run scripts/deploy.js --network amoy

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const network = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Deploying ProvenanceTracker to "${network}" from ${deployer.address}...`);

  const ProvenanceTracker = await hre.ethers.getContractFactory("ProvenanceTracker");
  const tracker = await ProvenanceTracker.deploy();
  await tracker.waitForDeployment();

  const address = await tracker.getAddress();
  const deployTx = tracker.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const record = {
    network,
    chainId,
    address,
    deployer: deployer.address,
    blockNumber: receipt ? receipt.blockNumber : null,
    txHash: deployTx ? deployTx.hash : null,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`ProvenanceTracker deployed to ${address}`);
  console.log(`Wrote ${path.relative(path.join(__dirname, ".."), outFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
