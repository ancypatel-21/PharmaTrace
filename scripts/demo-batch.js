// Creates a demo batch and moves it to InTransit, so the simulator has something it may report
// on (reportTemperature is only accepted for InTransit, Received and Stored batches).
// Local node only: it uses the default Hardhat signers that scripts/seed-roles.js registered.
//
//   npx hardhat node                                              (terminal 1)
//   npx hardhat run scripts/deploy.js --network localhost
//   npx hardhat run scripts/seed-roles.js --network localhost
//   npx hardhat run scripts/demo-batch.js --network localhost     prints the new batch ID
//   npm run sim -- --network localhost --batch <id> --scenario excursion

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const network = hre.network.name;
  if (network !== "localhost" && network !== "hardhat") {
    throw new Error(
      "demo-batch.js only runs on a local node (it uses the default Hardhat signers).",
    );
  }
  const file = path.join(__dirname, "..", "deployments", `${network}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No deployment found for "${network}". Run scripts/deploy.js first.`,
    );
  }
  const { address } = JSON.parse(fs.readFileSync(file, "utf8"));
  const tracker = await hre.ethers.getContractAt("ProvenanceTracker", address);

  // Same signer order as scripts/seed-roles.js.
  const [, manufacturer, distributor, , , regulator] =
    await hre.ethers.getSigners();

  const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  const lot = `LOT-${Date.now()}`;
  const registerTx = await tracker
    .connect(manufacturer)
    .registerBatch(
      "Insulin 10ml",
      lot,
      expiry,
      hre.ethers.id(`certificate-${lot}`),
    );
  const receipt = await registerTx.wait();
  const created = receipt.logs
    .map((entry) => {
      try {
        return tracker.interface.parseLog(entry);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed && parsed.name === "BatchRegistered");
  const batchId = created ? created.args[0] : await tracker.totalBatches();

  await (
    await tracker
      .connect(regulator)
      .approveBatch(batchId, hre.ethers.id(`approval-${lot}`))
  ).wait();
  await (
    await tracker
      .connect(manufacturer)
      .initiateTransfer(batchId, distributor.address)
  ).wait();

  console.log(
    `Batch ${batchId} (${lot}) registered, approved and InTransit to ${distributor.address}`,
  );
  console.log(
    `Next: npm run sim -- --network ${network} --batch ${batchId} --scenario excursion`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
